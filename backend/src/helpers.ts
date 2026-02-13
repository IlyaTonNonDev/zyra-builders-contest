import { Address } from "@ton/core";
import { pool } from "./db";
import {
  copyMessage,
  deleteMessage,
  getBotUser,
  getChatMember,
  getChatMemberCount,
  sendMessage,
} from "./telegramBot";
import { getTonConfigFromEnv, getJettonDecimals } from "./tonApi";
import {
  sendJettonTransfer,
  sendJettonTransferFromEscrow,
  sendTonFromEscrow,
} from "./toncenter";
import { decryptSecret } from "./escrowWallet";
import { logger } from "./logger";

/**
 * Безопасный запуск фоновой задачи (fire-and-forget).
 * Гарантирует, что ни одна ошибка — включая ошибки
 * внутри catch-блоков — не станет unhandled rejection.
 */
export const safeBackground = (fn: () => Promise<void>): void => {
  fn().catch((err) => {
    logger.error("Background task failed", err);
  });
};

/**
 * Парсит строковый параметр как целое число.
 * По умолчанию требует n >= 1 (ID из БД).
 * Для Telegram channel ID (отрицательные) передайте { allowNegative: true }.
 */
export function requireIntParam(
  val: string | undefined,
  name: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): number {
  const n = Number(val);
  if (
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    (!allowNegative && n < 1)
  ) {
    const err = new Error(`Invalid parameter ${name}: ${val}`) as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }
  return n;
}

// ─── Constants ───────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
export const botToken: string = BOT_TOKEN;

export const allowedTopics = new Set([
  "business",
  "crypto",
  "education",
  "entertainment",
  "lifestyle",
  "news",
  "tech",
]);

const SERVICE_COMMISSION_ADDRESS = String(
  process.env.SERVICE_COMMISSION_ADDRESS ??
    "UQC228vvLVzjK4t7CUfRhlQuxJqfB5sJzAZNEilvbpY6CzZk",
).trim();

const SERVICE_COMMISSION_PERCENT_RAW = String(
  process.env.SERVICE_COMMISSION_PERCENT ?? "0.2",
).trim();

// ─── Utility Functions ───────────────────────────────────────────────

export const getServiceCommissionPercent = (): number => {
  const raw = Number(SERVICE_COMMISSION_PERCENT_RAW);
  if (!Number.isFinite(raw) || raw < 0) {
    throw new Error("SERVICE_COMMISSION_PERCENT must be >= 0");
  }
  if (raw > 1) {
    return raw / 100;
  }
  return raw;
};

export const getServiceCommissionAddress = (): string => {
  if (!SERVICE_COMMISSION_ADDRESS) {
    throw new Error("SERVICE_COMMISSION_ADDRESS is not set");
  }
  Address.parse(SERVICE_COMMISSION_ADDRESS);
  return SERVICE_COMMISSION_ADDRESS;
};

export const splitPayoutAmount = (amountUsdt: string) => {
  const amount = Number(amountUsdt);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payout amount is invalid");
  }
  const percent = getServiceCommissionPercent();
  const commission = Math.round(amount * percent * 100) / 100;
  const payout = Math.round((amount - commission) * 100) / 100;
  if (payout <= 0) {
    throw new Error("Payout amount after commission is invalid");
  }
  return {
    payoutUsdt: payout.toFixed(2),
    commissionUsdt: commission.toFixed(2),
  };
};

// ─── Zyra Views (Python microservice) ────────────────────────────────
const VIEWS_SERVICE_URL = String(
  process.env.VIEWS_SERVICE_URL ?? "http://localhost:8000",
).trim();
const VIEWS_SERVICE_API_KEY = String(
  process.env.VIEWS_SERVICE_API_KEY ?? "",
).trim();

/**
 * Запрашивает охваты канала у микросервиса Zyra Views (app.py).
 * Для публичных каналов передаём @username, для остальных — telegram_id.
 */
export const fetchChannelViews = async (
  channelUsername: string | null,
): Promise<{ subscribers: number | null; avgViews: number | null }> => {
  if (!channelUsername) {
    logger.warn("[fetchChannelViews] skipped: channelUsername is empty/null");
    return { subscribers: null, avgViews: null };
  }

  const channel = channelUsername.startsWith("@")
    ? channelUsername
    : `@${channelUsername}`;

  const url = `${VIEWS_SERVICE_URL}/stats`;
  logger.info(`[fetchChannelViews] POST ${url} for ${channel}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": VIEWS_SERVICE_API_KEY,
      },
      body: JSON.stringify({ channel }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable>");
      logger.error(
        `[fetchChannelViews] Zyra Views returned ${response.status} for ${channel}: ${body}`,
      );
      return { subscribers: null, avgViews: null };
    }

    const data = (await response.json()) as {
      ok?: boolean;
      stats?: { subscribers?: number; avg_views?: number };
    };

    logger.info(
      `[fetchChannelViews] ${channel} → subscribers=${data.stats?.subscribers ?? "null"}, avg_views=${data.stats?.avg_views ?? "null"}`,
    );

    return {
      subscribers: data.stats?.subscribers ?? null,
      avgViews: data.stats?.avg_views ?? null,
    };
  } catch (err) {
    logger.error(
      `[fetchChannelViews] fetch failed for ${channel} (url=${url})`,
      err,
    );
    return { subscribers: null, avgViews: null };
  }
};

export const computeChannelAvgViews = async (
  channelTelegramId: number,
): Promise<number | null> => {
  const { rows } = await pool.query(
    `
      SELECT AVG(view_count)::numeric(12, 2) as avg_views
      FROM (
        SELECT view_count
        FROM channel_post_views
        WHERE channel_telegram_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      ) recent
    `,
    [channelTelegramId],
  );
  const avg = rows[0]?.avg_views;
  if (avg === null || avg === undefined) {
    return null;
  }
  const value = Number(avg);
  return Number.isFinite(value) ? value : null;
};

export const updateChannelStats = async (
  channelTelegramId: number,
): Promise<void> => {
  logger.info(`[updateChannelStats] start for channel ${channelTelegramId}`);

  // Получаем username канала из БД
  const { rows: chRows } = await pool.query(
    "SELECT username FROM channels WHERE telegram_id = $1",
    [channelTelegramId],
  );
  const username: string | null = chRows[0]?.username ?? null;

  // Пробуем получить охваты из Zyra Views (app.py)
  let subscribers: number | null = null;
  let avgViews: number | null = null;

  if (!username) {
    logger.warn(
      `[updateChannelStats] channel ${channelTelegramId}: username is null, skipping Zyra Views`,
    );
  } else if (!VIEWS_SERVICE_API_KEY) {
    logger.warn(
      `[updateChannelStats] VIEWS_SERVICE_API_KEY is empty — Zyra Views call skipped. ` +
        `Set VIEWS_SERVICE_API_KEY in backend .env (must match SERVICE_API_KEY in app.py .env). ` +
        `VIEWS_SERVICE_URL=${VIEWS_SERVICE_URL}`,
    );
  } else {
    logger.info(
      `[updateChannelStats] calling Zyra Views for @${username} (url=${VIEWS_SERVICE_URL})`,
    );
    const views = await fetchChannelViews(username);
    subscribers = views.subscribers;
    avgViews = views.avgViews;
  }

  // Фоллбэк: подписчики из Bot API, если Zyra Views не вернул
  if (subscribers === null) {
    logger.info(
      `[updateChannelStats] subscribers fallback → Bot API getChatMemberCount`,
    );
    subscribers = await getChatMemberCount(botToken, String(channelTelegramId));
  }

  // Фоллбэк: охваты из channel_post_views, если Zyra Views не вернул
  if (avgViews === null) {
    logger.info(
      `[updateChannelStats] avgViews fallback → computeChannelAvgViews (local DB)`,
    );
    avgViews = await computeChannelAvgViews(channelTelegramId);
  }

  const err =
    subscribers && avgViews
      ? Number(((avgViews / subscribers) * 100).toFixed(2))
      : null;

  logger.info(
    `[updateChannelStats] channel ${channelTelegramId}: subscribers=${subscribers}, avgViews=${avgViews}, err=${err}`,
  );

  await pool.query(
    `
      UPDATE channels
      SET subscribers = $2,
          avg_views = COALESCE($3, avg_views),
          err = COALESCE($4, err)
      WHERE telegram_id = $1
    `,
    [channelTelegramId, subscribers, avgViews, err],
  );
};

export const toJettonAmount = (value: string, decimals: number): string => {
  const [wholeRaw, fracRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const frac = fracRaw.replace(/\D/g, "");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${padded}`.replace(/^0+/, "") || "0";
  return combined;
};

export const parseSeqnoFromTxHash = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/^seqno:(\d+)$/);
  if (!match) {
    return null;
  }
  const seqno = Number(match[1]);
  return Number.isFinite(seqno) ? seqno : null;
};

export const notifyUser = async (telegramId: number | string, text: string) => {
  try {
    await sendMessage(botToken, String(telegramId), text);
  } catch {
    // Ignore notification errors.
  }
};

export const getCampaignNotificationTargets = async (appId: number) => {
  const { rows } = await pool.query(
    `
      SELECT
        ca.id AS application_id,
        ca.campaign_id,
        ca.proposed_price,
        c.ad_text,
        c.price_per_post,
        ch.title AS channel_title,
        ch.username AS channel_username,
        adv.telegram_id AS advertiser_telegram_id,
        owner.telegram_id AS channel_owner_telegram_id
      FROM campaign_applications ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN channels ch ON ch.id = ca.channel_id
      JOIN users adv ON adv.id = c.advertiser_user_id
      JOIN users owner ON owner.id = ch.added_by_user_id
      WHERE ca.id = $1
      LIMIT 1
    `,
    [appId],
  );
  return rows[0] ?? null;
};

export const publishCampaignApplicationInternal = async (
  appId: number,
  ownerTelegramId?: number,
) => {
  const { rows } = await pool.query(
    `
      SELECT
        ca.id AS application_id,
        ca.status AS application_status,
        ca.published_message_id,
        ch.telegram_id AS channel_telegram_id,
        ch.title AS channel_title,
        ch.username AS channel_username,
        c.ad_text,
        u.telegram_id AS owner_telegram_id
      FROM campaign_applications ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN channels ch ON ch.id = ca.channel_id
      JOIN users u ON u.id = ch.added_by_user_id
      WHERE ca.id = $1
    `,
    [appId],
  );
  if (rows.length === 0) {
    throw new Error("Application not found");
  }

  const application = rows[0];
  if (
    typeof ownerTelegramId === "number" &&
    Number(application.owner_telegram_id) !== ownerTelegramId
  ) {
    throw new Error("You are not the owner of this channel");
  }
  if (application.application_status !== "accepted") {
    throw new Error("Application is not accepted");
  }
  if (application.published_message_id) {
    throw new Error("Application already published");
  }

  const channelId = String(application.channel_telegram_id);
  if (typeof ownerTelegramId === "number") {
    const member = await getChatMember(botToken, channelId, ownerTelegramId);
    const isAdmin =
      member.status === "administrator" || member.status === "creator";
    if (!isAdmin) {
      throw new Error("User is not a channel admin");
    }
  }
  const botUser = await getBotUser(botToken);
  const botMember = await getChatMember(botToken, channelId, botUser.id);
  if (botMember.status !== "administrator") {
    throw new Error("Bot is not a channel admin");
  }
  if (botMember.can_post_messages === false) {
    throw new Error("Bot cannot post messages in this channel");
  }

  const message = await sendMessage(
    botToken,
    channelId,
    String(application.ad_text),
  );

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE campaign_applications
      SET
        published_message_id = $2,
        published_at = NOW(),
        status = 'published',
        verify_status = 'pending',
        verify_error = NULL,
        payout_status = 'verification_pending',
        payout_ready_at = NOW() + ($3 || ' minutes')::interval,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, published_message_id, published_at, payout_ready_at
    `,
    [appId, message.message_id, getPayoutDelayMinutes()],
  );

  return { application: updatedRows[0], messageId: message.message_id };
};

export const getCampaignPayoutGasReserveNano = (count: number): bigint => {
  const raw = String(process.env.CAMPAIGN_PAYOUT_GAS_TON ?? "0.06").trim();
  const perPost = Number(raw);
  if (!Number.isFinite(perPost) || perPost < 0) {
    throw new Error("CAMPAIGN_PAYOUT_GAS_TON must be >= 0");
  }
  const perPostNano = BigInt(Math.round(perPost * 1e9));
  return perPostNano * BigInt(Math.max(count, 0));
};

export const getCampaignPendingPayoutCount = async (
  campaignId: number,
): Promise<number> => {
  const { rows } = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM campaign_applications
      WHERE campaign_id = $1
        AND status = 'published'
        AND payout_tx_hash IS NULL
        AND (payout_status IS NULL OR payout_status <> 'sent')
    `,
    [campaignId],
  );
  return Number(rows[0]?.count ?? 0);
};

export const buildTonkeeperUrl = (
  escrowAddress: string,
  jettonMaster: string,
  amount: string,
  comment: string,
): string => {
  const params = new URLSearchParams({
    jetton: jettonMaster,
    amount,
    text: comment,
  });
  return `https://app.tonkeeper.com/transfer/${escrowAddress}?${params.toString()}`;
};

export const getPayoutDelayMinutes = (): number => {
  const payoutDelayRaw = String(process.env.PAYOUT_DELAY_MINUTES ?? "3").trim();
  const payoutDelayMinutes = Number(payoutDelayRaw);
  if (!Number.isFinite(payoutDelayMinutes) || payoutDelayMinutes <= 0) {
    throw new Error("PAYOUT_DELAY_MINUTES must be > 0");
  }
  return payoutDelayMinutes;
};

export const getEscrowRequiredTonNano = (): bigint => {
  const requiredRaw = String(process.env.ESCROW_REQUIRED_TON ?? "1").trim();
  const required = Number(requiredRaw);
  if (!Number.isFinite(required) || required <= 0) {
    throw new Error("ESCROW_REQUIRED_TON must be > 0");
  }
  return BigInt(Math.round(required * 1e9));
};

export const getEscrowRequiredTonMinNano = (): bigint => {
  const minRaw = String(process.env.ESCROW_REQUIRED_TON_MIN ?? "0.9").trim();
  const min = Number(minRaw);
  if (!Number.isFinite(min) || min <= 0) {
    throw new Error("ESCROW_REQUIRED_TON_MIN must be > 0");
  }
  const required = getEscrowRequiredTonNano();
  const minNano = BigInt(Math.round(min * 1e9));
  return minNano > required ? required : minNano;
};

export const getJettonGasNano = (): bigint => {
  const gasRaw = String(process.env.TON_JETTON_GAS ?? "0.05").trim();
  const gas = Number(gasRaw);
  if (!Number.isFinite(gas) || gas <= 0) {
    throw new Error("TON_JETTON_GAS must be > 0");
  }
  return BigInt(Math.round(gas * 1e9));
};

export const base64Url = (value: string): string =>
  value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const getEscrowTonBufferNano = (): bigint => {
  const bufferRaw = String(process.env.ESCROW_TON_BUFFER ?? "0.5").trim();
  const buffer = Number(bufferRaw);
  if (!Number.isFinite(buffer) || buffer < 0) {
    throw new Error("ESCROW_TON_BUFFER must be >= 0");
  }
  return BigInt(Math.round(buffer * 1e9));
};

export const isRetryAfterError = (message: string): boolean =>
  message.includes("retry_after");

export const checkMessageExists = async (
  botTokenValue: string,
  channelId: string,
  messageId: number,
): Promise<boolean> => {
  const logChatId = String(process.env.BOT_LOG_CHAT_ID ?? "").trim();
  if (!logChatId) {
    throw new Error("BOT_LOG_CHAT_ID is not set");
  }

  try {
    const copy = await copyMessage(
      botTokenValue,
      channelId,
      messageId,
      logChatId,
    );
    if (copy?.message_id) {
      try {
        await deleteMessage(botTokenValue, logChatId, copy.message_id);
      } catch {
        // Ignore cleanup errors.
      }
      return true;
    }
    return false;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to verify message";
    if (
      message.toLowerCase().includes("message to copy not found") ||
      message.toLowerCase().includes("message_id_invalid") ||
      message.toLowerCase().includes("message id invalid")
    ) {
      return false;
    }
    throw new Error(message);
  }
};

export const triggerRefund = (params: {
  paymentId: number;
  payerAddress: string;
  totalUsdt: string;
  reference?: string | null;
  escrowAddress?: string | null;
  escrowSecretEncrypted?: string | null;
}) => {
  safeBackground(async () => {
    try {
      const tonConfig = getTonConfigFromEnv();
      const decimals = await getJettonDecimals(
        tonConfig.usdtJettonMaster,
        tonConfig.apiKey,
      );
      const refundAmount = toJettonAmount(params.totalUsdt, decimals);
      const refundComment = params.reference
        ? `refund_${params.reference}`
        : undefined;

      const refund =
        params.escrowAddress && params.escrowSecretEncrypted
          ? await sendJettonTransferFromEscrow({
              toAddress: params.payerAddress,
              jettonAmount: refundAmount,
              comment: refundComment,
              escrowAddress: params.escrowAddress,
              escrowSecretKey: decryptSecret(params.escrowSecretEncrypted),
            })
          : await sendJettonTransfer({
              toAddress: params.payerAddress,
              jettonAmount: refundAmount,
              comment: refundComment,
            });

      await pool.query(
        `
          UPDATE payments
          SET
            refund_tx_hash = $2,
            refunded_at = NOW(),
            refund_status = 'sent',
            refund_error = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [params.paymentId, refund.txHash],
      );

      if (
        params.escrowAddress &&
        params.escrowSecretEncrypted &&
        params.payerAddress
      ) {
        try {
          const afterSeqno = parseSeqnoFromTxHash(refund.txHash);
          await sendTonFromEscrow({
            toAddress: params.payerAddress,
            escrowAddress: params.escrowAddress,
            escrowSecretKey: decryptSecret(params.escrowSecretEncrypted),
            afterSeqno,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "TON refund failed";
          await pool.query(
            `
              UPDATE payments
              SET refund_error = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [params.paymentId, `TON refund failed: ${message}`],
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refund failed";
      await pool.query(
        `
          UPDATE payments
          SET
            refund_status = 'failed',
            refund_error = $2,
            updated_at = NOW()
          WHERE id = $1
        `,
        [params.paymentId, message],
      );
    }
  });
};

export const triggerPayout = (params: {
  paymentId: number;
  payoutAddress: string;
  amountUsdt: string;
  reference?: string | null;
  escrowAddress?: string | null;
  escrowSecretEncrypted?: string | null;
}) => {
  safeBackground(async () => {
    try {
      const tonConfig = getTonConfigFromEnv();
      const decimals = await getJettonDecimals(
        tonConfig.usdtJettonMaster,
        tonConfig.apiKey,
      );
      const { payoutUsdt, commissionUsdt } = splitPayoutAmount(
        params.amountUsdt,
      );
      const payoutAmount = toJettonAmount(payoutUsdt, decimals);
      const commissionAmount = toJettonAmount(commissionUsdt, decimals);
      const payoutComment = params.reference
        ? `payout_${params.reference}`
        : undefined;
      const commissionComment = params.reference
        ? `commission_${params.reference}`
        : undefined;

      const escrowAddress = params.escrowAddress;
      const escrowSecret = params.escrowSecretEncrypted
        ? decryptSecret(params.escrowSecretEncrypted)
        : undefined;

      if (!escrowAddress || !escrowSecret) {
        throw new Error("escrow is missing");
      }

      if (Number(commissionUsdt) > 0) {
        await sendJettonTransferFromEscrow({
          toAddress: getServiceCommissionAddress(),
          jettonAmount: commissionAmount,
          comment: commissionComment,
          escrowAddress,
          escrowSecretKey: escrowSecret,
        });
      }

      const payout = await sendJettonTransferFromEscrow({
        toAddress: params.payoutAddress,
        jettonAmount: payoutAmount,
        comment: payoutComment,
        escrowAddress,
        escrowSecretKey: escrowSecret,
      });

      await pool.query(
        `
          UPDATE payments
          SET
            payout_tx_hash = $2,
            payout_status = 'sent',
            payout_error = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [params.paymentId, payout.txHash],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payout failed";
      await pool.query(
        `
          UPDATE payments
          SET
            payout_status = 'failed',
            payout_error = $2,
            updated_at = NOW()
          WHERE id = $1
        `,
        [params.paymentId, message],
      );
    }
  });
};
