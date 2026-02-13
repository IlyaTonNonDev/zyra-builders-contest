import { Pool } from "pg";
import { assertEnvFileIsPrivate } from "./envSecurity";

assertEnvFileIsPrivate();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 20,                       // макс. соединений (по умолчанию 10 — мало для 3 фоновых задач + API)
  connectionTimeoutMillis: 5_000, // ждать свободное соединение не дольше 5 сек
  idleTimeoutMillis: 30_000,      // закрывать idle-соединения через 30 сек
  statement_timeout: 30_000,      // убивать SQL-запросы длиннее 30 сек
});

// Ошибки idle-соединений (например, БД рестартнулась) не должны
// крашить процесс — логируем и отпускаем соединение.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected idle pool client error:", err.message);
});

export async function ensureUsersTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function ensureRolesTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
  `);

  await pool.query(`
    INSERT INTO roles (name)
    VALUES ('channel_admin'), ('advertiser')
    ON CONFLICT (name) DO NOTHING;
  `);
}

export async function ensureChannelsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      username TEXT,
      added_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS topic TEXT;`);
  await pool.query(
    `ALTER TABLE channels ADD COLUMN IF NOT EXISTS price_usdt NUMERIC(12, 2);`,
  );
  await pool.query(
    `ALTER TABLE channels ADD COLUMN IF NOT EXISTS subscribers INTEGER;`,
  );
  await pool.query(
    `ALTER TABLE channels ADD COLUMN IF NOT EXISTS avg_views INTEGER;`,
  );
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS err NUMERIC(5, 2);`);
  await pool.query(`ALTER TABLE channels ADD COLUMN IF NOT EXISTS payout_address TEXT;`);

  // ─── Индексы для частых запросов ──────────────────────────────────
  // «Мои каналы»: WHERE added_by_user_id = $1
  await pool.query(
    `CREATE INDEX IF NOT EXISTS channels_added_by_user_id_idx ON channels(added_by_user_id);`,
  );
}

export async function ensureOrdersTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_groups (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES order_groups(id) ON DELETE CASCADE,
      channel_telegram_id BIGINT NOT NULL,
      ad_text TEXT NOT NULL,
      publish_at TIMESTAMPTZ NOT NULL,
      price_usdt NUMERIC(12, 2),
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS orders_group_id_idx ON orders(group_id);`,
  );

  // ─── Индексы для частых запросов ──────────────────────────────────
  // Корзина: WHERE telegram_id = $1 AND status = 'draft' (каждый запрос корзины)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS order_groups_telegram_status_idx ON order_groups(telegram_id, status);`,
  );
  // JOIN channels c ON c.telegram_id = o.channel_telegram_id (заказы, выплаты)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS orders_channel_telegram_id_idx ON orders(channel_telegram_id);`,
  );
  await pool.query(
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS published_message_id INTEGER;`,
  );
  await pool.query(
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS published_channel_id BIGINT;`,
  );
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS publish_status TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS publish_error TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS verify_status TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS verify_error TEXT;`);
}

export async function ensurePaymentsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_group_id INTEGER NOT NULL REFERENCES order_groups(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'paid')),
      amount_usdt NUMERIC(12, 2) NOT NULL,
      fee_usdt NUMERIC(12, 2) NOT NULL,
      total_usdt NUMERIC(12, 2) NOT NULL,
      reference TEXT,
      provider TEXT,
      escrow_address TEXT,
      external_id TEXT,
      payer_address TEXT,
      paid_tx_hash TEXT,
      paid_at TIMESTAMPTZ,
      confirmations INTEGER,
      refund_tx_hash TEXT,
      refunded_at TIMESTAMPTZ,
      refund_status TEXT,
      refund_error TEXT,
      payout_status TEXT,
      payout_ready_at TIMESTAMPTZ,
      payout_tx_hash TEXT,
      payout_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS payments_order_group_id_idx ON payments(order_group_id);`,
  );

  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_address TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_tx_hash TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmations INTEGER;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_status TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_error TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_status TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_ready_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT;`);
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS payout_error TEXT;`);
  await pool.query(
    `ALTER TABLE payments ADD COLUMN IF NOT EXISTS escrow_private_key_encrypted TEXT;`,
  );
  await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS escrow_address_raw TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS payments_reference_idx ON payments(reference);`);

  // ─── Индекс для фоновой задачи processScheduledPayouts (каждые 30с) ─
  // WHERE status = 'accepted' AND payout_status = 'verification_pending'
  //   AND payout_ready_at IS NOT NULL AND payout_ready_at <= NOW()
  await pool.query(
    `CREATE INDEX IF NOT EXISTS payments_payout_pending_idx ON payments(status, payout_status, payout_ready_at);`,
  );
}

export async function ensureCampaignsTables(): Promise<void> {
  // Campaigns table - advertiser creates campaigns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      advertiser_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ad_text TEXT NOT NULL,
      budget_usdt NUMERIC(12, 2) NOT NULL,
      price_per_post NUMERIC(12, 2),
      remaining_usdt NUMERIC(12, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'closed', 'cancelled')),
      escrow_address TEXT,
      escrow_address_raw TEXT,
      escrow_private_key_encrypted TEXT,
      payment_reference TEXT,
      paid_tx_hash TEXT,
      paid_at TIMESTAMPTZ,
      payer_address TEXT,
      refund_tx_hash TEXT,
      refunded_at TIMESTAMPTZ,
      refund_status TEXT,
      refund_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS escrow_address_raw TEXT;`);
  await pool.query(
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS escrow_private_key_encrypted TEXT;`,
  );
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT;`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS refund_status TEXT;`);
  await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS refund_error TEXT;`);

  await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_advertiser_idx ON campaigns(advertiser_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);`);
  // Поиск кампании по reference: WHERE payment_reference = $1
  await pool.query(
    `CREATE INDEX IF NOT EXISTS campaigns_payment_reference_idx ON campaigns(payment_reference);`,
  );

  // Campaign applications - channel admins apply to campaigns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_applications (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      proposed_price NUMERIC(12, 2),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'published')),
      published_message_id INTEGER,
      published_at TIMESTAMPTZ,
      verify_status TEXT,
      verified_at TIMESTAMPTZ,
      verify_error TEXT,
      payout_ready_at TIMESTAMPTZ,
      payout_status TEXT,
      payout_error TEXT,
      payout_tx_hash TEXT,
      payout_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(campaign_id, channel_id)
    );
  `);

  await pool.query(
    `ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS campaign_id INTEGER;`,
  );
  await pool.query(
    `ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS channel_id INTEGER;`,
  );
  await pool.query(`ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS verify_status TEXT;`);
  await pool.query(`ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS verify_error TEXT;`);
  await pool.query(
    `ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS payout_ready_at TIMESTAMPTZ;`,
  );
  await pool.query(`ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS payout_status TEXT;`);
  await pool.query(`ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS payout_error TEXT;`);

  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_applications_campaign_idx ON campaign_applications(campaign_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS campaign_applications_channel_idx ON campaign_applications(channel_id);`);

  // ─── Индекс для фоновой задачи processCampaignApplicationPayouts (каждые 30с) ─
  // WHERE status = 'published' AND payout_ready_at IS NOT NULL AND payout_ready_at <= NOW()
  //   AND payout_tx_hash IS NULL
  await pool.query(
    `CREATE INDEX IF NOT EXISTS campaign_apps_payout_pending_idx ON campaign_applications(status, payout_ready_at) WHERE payout_tx_hash IS NULL;`,
  );
}

export async function ensureChannelPostViewsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_post_views (
      id SERIAL PRIMARY KEY,
      channel_telegram_id BIGINT NOT NULL,
      view_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS channel_post_views_channel_idx ON channel_post_views(channel_telegram_id);`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS channel_post_views_created_idx ON channel_post_views(created_at);`,
  );
}
