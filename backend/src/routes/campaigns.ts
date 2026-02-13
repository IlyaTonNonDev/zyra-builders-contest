import { Router } from "express";
import { randomBytes } from "crypto";
import { pool } from "../db";
import { generateEscrowWallet, decryptSecret } from "../escrowWallet";
import {
  getJettonDecimals,
  getTonConfigFromEnv,
  getJettonWalletAddress,
  normalizeTonAddress,
  getAccountEvents,
  getAccountTonBalance,
  getMasterchainSeqno,
  getTransactionSeqno,
} from "../tonApi";
import {
  buildJettonTransferPayload,
  sendJettonTransfer,
  sendJettonTransferFromEscrow,
  sendTonFromEscrow,
} from "../toncenter";
import {
  botToken,
  toJettonAmount,
  buildTonkeeperUrl,
  getEscrowRequiredTonNano,
  getEscrowRequiredTonMinNano,
  getJettonGasNano,
  base64Url,
  getEscrowTonBufferNano,
  isRetryAfterError,
  checkMessageExists,
  splitPayoutAmount,
  getServiceCommissionAddress,
  parseSeqnoFromTxHash,
  getPayoutDelayMinutes,
  notifyUser,
  getCampaignNotificationTargets,
  publishCampaignApplicationInternal,
  getCampaignPayoutGasReserveNano,
  getCampaignPendingPayoutCount,
  safeBackground,
  requireIntParam,
} from "../helpers";
import { asyncHandler } from "../asyncHandler";
import { logger } from "../logger";

const router = Router();

// ============================================================
// CAMPAIGNS API
// ============================================================

// Create a new campaign (advertiser)
router.post("/campaigns", asyncHandler(async (req, res) => {
  try {
    const telegramId = Number(req.body?.telegramId);
    const adText = String(req.body?.adText ?? "").trim();
    const budgetUsdt = Number(req.body?.budgetUsdt);
    const pricePerPost = req.body?.pricePerPost ? Number(req.body.pricePerPost) : null;

    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }
    if (!adText) {
      return res.status(400).json({ error: "adText is required" });
    }
    if (!Number.isFinite(budgetUsdt) || budgetUsdt < 0.1) {
      return res.status(400).json({ error: "budgetUsdt must be at least 0.1" });
    }
    if (pricePerPost !== null && (!Number.isFinite(pricePerPost) || pricePerPost < 0.1)) {
      return res.status(400).json({ error: "pricePerPost must be at least 0.1" });
    }

    const { rows: userRows } = await pool.query(
      "SELECT id FROM users WHERE telegram_id = $1",
      [telegramId],
    );
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const reference = `campaign_${randomBytes(8).toString("hex")}`;
    const tonConfig = getTonConfigFromEnv();
    const escrowWallet = await generateEscrowWallet();

    const { rows } = await pool.query(
      `
        INSERT INTO campaigns (
          advertiser_user_id,
          ad_text,
          budget_usdt,
          price_per_post,
          remaining_usdt,
          status,
          escrow_address,
          escrow_address_raw,
          escrow_private_key_encrypted,
          payment_reference
        )
        VALUES ($1, $2, $3, $4, $3, 'pending', $5, $6, $7, $8)
        RETURNING
          id,
          advertiser_user_id,
          ad_text,
          budget_usdt,
          price_per_post,
          remaining_usdt,
          status,
          escrow_address,
          payment_reference,
          paid_tx_hash,
          paid_at,
          payer_address,
          created_at,
          updated_at
      `,
      [
        userRows[0].id,
        adText,
        budgetUsdt,
        pricePerPost,
        escrowWallet.address,
        escrowWallet.addressRaw,
        escrowWallet.secretKeyEncrypted,
        reference,
      ],
    );

    // Generate Tonkeeper payment link
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const jettonAmount = toJettonAmount(String(budgetUsdt), decimals);

    const tonkeeperUrl = buildTonkeeperUrl(
      escrowWallet.address,
      tonConfig.usdtJettonMaster,
      jettonAmount,
      reference,
    );

    return res.status(200).json({
      campaign: rows[0],
      payment: {
        tonkeeperUrl,
        comment: reference,
        amount: budgetUsdt,
        escrowAddress: escrowWallet.address,
        requiredTonNano: getEscrowRequiredTonNano().toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Get active campaigns (for channel admins to see)
router.get("/campaigns", asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `
      SELECT 
        c.id,
        c.advertiser_user_id,
        c.ad_text,
        c.budget_usdt,
        c.price_per_post,
        c.remaining_usdt,
        c.status,
        c.created_at,
        c.updated_at,
        u.telegram_id as advertiser_telegram_id,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id) as applications_count,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id AND ca.status = 'accepted') as accepted_count,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id AND ca.status = 'pending') as pending_count
      FROM campaigns c
      JOIN users u ON u.id = c.advertiser_user_id
      WHERE c.status = 'active'
      ORDER BY c.created_at DESC
    `,
  );

  return res.status(200).json({ campaigns: rows });
}));

// Get my campaigns (advertiser)
router.get("/campaigns/my/:telegramId", asyncHandler(async (req, res) => {
  const telegramId = requireIntParam(req.params.telegramId, "telegramId");
  if (req.telegramId && req.telegramId !== telegramId) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { rows: userRows } = await pool.query(
    "SELECT id FROM users WHERE telegram_id = $1",
    [telegramId],
  );
  if (userRows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const { rows } = await pool.query(
    `
      SELECT 
        c.id,
        c.advertiser_user_id,
        c.ad_text,
        c.budget_usdt,
        c.price_per_post,
        c.remaining_usdt,
        c.status,
        c.created_at,
        c.updated_at,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id) as applications_count,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id AND ca.status = 'accepted') as accepted_count,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id AND ca.status = 'pending') as pending_count,
        (SELECT COUNT(*) FROM campaign_applications ca WHERE ca.campaign_id = c.id AND ca.status = 'published') as published_count
      FROM campaigns c
      WHERE c.advertiser_user_id = $1
      ORDER BY c.created_at DESC
    `,
    [userRows[0].id],
  );

  return res.status(200).json({ campaigns: rows });
}));

// Get campaign details
router.get("/campaigns/:id", asyncHandler(async (req, res) => {
  const campaignId = requireIntParam(req.params.id, "id");

  const { rows } = await pool.query(
    `
      SELECT 
        c.id,
        c.advertiser_user_id,
        c.ad_text,
        c.budget_usdt,
        c.price_per_post,
        c.remaining_usdt,
        c.status,
        c.payment_reference,
        c.paid_tx_hash,
        c.paid_at,
        c.payer_address,
        c.created_at,
        c.updated_at,
        u.telegram_id as advertiser_telegram_id
      FROM campaigns c
      JOIN users u ON u.id = c.advertiser_user_id
      WHERE c.id = $1
    `,
    [campaignId],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  return res.status(200).json({ campaign: rows[0] });
}));

// Get campaign applications
router.get("/campaigns/:id/applications", asyncHandler(async (req, res) => {
  const campaignId = requireIntParam(req.params.id, "id");

  const { rows } = await pool.query(
    `
      SELECT 
        ca.*,
        ch.telegram_id as channel_telegram_id,
        ch.title as channel_title,
        ch.username as channel_username,
        ch.subscribers as channel_subscribers,
        ch.avg_views as channel_avg_views,
        ch.price_usdt as channel_price
      FROM campaign_applications ca
      JOIN channels ch ON ch.id = ca.channel_id
      WHERE ca.campaign_id = $1
      ORDER BY ca.created_at DESC
    `,
    [campaignId],
  );

  return res.status(200).json({ applications: rows });
}));

// Apply to campaign (channel admin)
router.post("/campaigns/:id/apply", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const telegramId = Number(req.body?.telegramId);
    const channelTelegramId = Number(req.body?.channelTelegramId);
    const proposedPrice = req.body?.proposedPrice ? Number(req.body.proposedPrice) : null;

    if (!campaignId) {
      return res.status(400).json({ error: "Invalid campaign id" });
    }
    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }
    if (!channelTelegramId) {
      return res.status(400).json({ error: "channelTelegramId is required" });
    }

    // Verify campaign exists and is active
    const { rows: campaignRows } = await pool.query(
      "SELECT id, status, price_per_post, remaining_usdt FROM campaigns WHERE id = $1",
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaignRows[0].status !== 'active') {
      return res.status(400).json({ error: "Campaign is not active" });
    }

    // Verify channel exists and user is the owner
    const { rows: channelRows } = await pool.query(
      `
        SELECT ch.id, ch.added_by_user_id, u.telegram_id
        FROM channels ch
        JOIN users u ON u.id = ch.added_by_user_id
        WHERE ch.telegram_id = $1
      `,
      [channelTelegramId],
    );
    if (channelRows.length === 0) {
      return res.status(404).json({ error: "Channel not found" });
    }
    if (Number(channelRows[0].telegram_id) !== telegramId) {
      return res.status(403).json({ error: "You are not the owner of this channel" });
    }

    // Check price constraint
    const campaign = campaignRows[0];
    const finalPrice = proposedPrice || campaign.price_per_post;
    if (campaign.price_per_post && proposedPrice && proposedPrice > Number(campaign.price_per_post)) {
      return res.status(400).json({ error: `Price cannot exceed ${campaign.price_per_post} USDT` });
    }
    if (finalPrice && Number(campaign.remaining_usdt) < finalPrice) {
      return res.status(400).json({ error: "Campaign budget is insufficient" });
    }

    // Create application
    const { rows } = await pool.query(
      `
        INSERT INTO campaign_applications (campaign_id, channel_id, proposed_price, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (campaign_id, channel_id) DO UPDATE SET
          proposed_price = EXCLUDED.proposed_price,
          status = 'pending',
          updated_at = NOW()
        RETURNING
          id,
          campaign_id,
          channel_id,
          proposed_price,
          status,
          created_at,
          updated_at
      `,
      [campaignId, channelRows[0].id, finalPrice],
    );

    return res.status(200).json({ application: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Accept application (advertiser)
router.post("/campaigns/:id/accept/:appId", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const appId = requireIntParam(req.params.appId, "appId");
    const telegramId = Number(req.body?.telegramId);

    if (!campaignId || !appId || !telegramId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Verify ownership
    const { rows: campaignRows } = await pool.query(
      `
        SELECT c.id, c.status, c.price_per_post, c.remaining_usdt,
               u.telegram_id as owner_telegram_id
        FROM campaigns c
        JOIN users u ON u.id = c.advertiser_user_id
        WHERE c.id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (Number(campaignRows[0].owner_telegram_id) !== telegramId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Get application
    const { rows: appRows } = await pool.query(
      "SELECT id, campaign_id, channel_id, proposed_price, status FROM campaign_applications WHERE id = $1 AND campaign_id = $2",
      [appId, campaignId],
    );
    if (appRows.length === 0) {
      return res.status(404).json({ error: "Application not found" });
    }
    if (appRows[0].status !== 'pending') {
      return res.status(400).json({ error: "Application is not pending" });
    }

    const price = Number(appRows[0].proposed_price || campaignRows[0].price_per_post || 0);
    if (price > Number(campaignRows[0].remaining_usdt)) {
      return res.status(400).json({ error: "Insufficient campaign budget" });
    }

    // Update application status and deduct from budget
    await pool.query("BEGIN");
    try {
      await pool.query(
        "UPDATE campaign_applications SET status = 'accepted', updated_at = NOW() WHERE id = $1",
        [appId],
      );

      await pool.query(
        "UPDATE campaigns SET remaining_usdt = remaining_usdt - $2, updated_at = NOW() WHERE id = $1",
        [campaignId, price],
      );

      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }

    safeBackground(async () => {
      const targets = await getCampaignNotificationTargets(appId);
      if (!targets) {
        return;
      }
      const channelLabel = targets.channel_username
        ? `@${targets.channel_username}`
        : targets.channel_title;
      const price = Number(targets.proposed_price ?? targets.price_per_post ?? 0);
      await notifyUser(
        Number(targets.channel_owner_telegram_id),
        `✅ Заявка по кампании #${targets.campaign_id} принята.\n` +
          `Канал: ${channelLabel}\n` +
          `Цена: ${price} USDT\n` +
          `Можно публиковать пост в разделе "Заказы".`,
      );
    });

    safeBackground(async () => {
      try {
        const result = await publishCampaignApplicationInternal(appId);
        const targets = await getCampaignNotificationTargets(appId);
        if (!targets) {
          return;
        }
        const channelLabel = targets.channel_username
          ? `@${targets.channel_username}`
          : targets.channel_title;
        await notifyUser(
          Number(targets.advertiser_telegram_id),
          `📤 Пост опубликован по кампании #${targets.campaign_id}.\n` +
            `Канал: ${channelLabel}\n` +
            `Выплата через ~${getPayoutDelayMinutes()} мин после проверки.`,
        );
        await notifyUser(
          Number(targets.channel_owner_telegram_id),
          `📤 Пост опубликован по кампании #${targets.campaign_id}.\n` +
            `Канал: ${channelLabel}\n` +
            `ID сообщения: ${result.messageId}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Auto publish failed";
        const targets = await getCampaignNotificationTargets(appId);
        if (!targets) {
          return;
        }
        await notifyUser(
          Number(targets.advertiser_telegram_id),
          `⚠️ Автопубликация по кампании #${targets.campaign_id} не удалась: ${message}`,
        );
      }
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Reject application (advertiser)
router.post("/campaigns/:id/reject/:appId", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const appId = requireIntParam(req.params.appId, "appId");
    const telegramId = Number(req.body?.telegramId);

    if (!campaignId || !appId || !telegramId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Verify ownership
    const { rows: campaignRows } = await pool.query(
      `
        SELECT c.id, u.telegram_id as owner_telegram_id
        FROM campaigns c
        JOIN users u ON u.id = c.advertiser_user_id
        WHERE c.id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (Number(campaignRows[0].owner_telegram_id) !== telegramId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    await pool.query(
      "UPDATE campaign_applications SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND campaign_id = $2",
      [appId, campaignId],
    );

    // Notify channel owner about rejection
    safeBackground(async () => {
      const targets = await getCampaignNotificationTargets(appId);
      if (!targets) return;
      const channelLabel = targets.channel_username
        ? `@${targets.channel_username}`
        : targets.channel_title;
      await notifyUser(
        Number(targets.channel_owner_telegram_id),
        `❌ Заявка по кампании #${targets.campaign_id} отклонена.\nКанал: ${channelLabel}`,
      );
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Close campaign (return remaining budget)
router.post("/campaigns/:id/close", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const telegramId = Number(req.body?.telegramId);

    if (!campaignId || !telegramId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Verify ownership
    const { rows: campaignRows } = await pool.query(
      `
        SELECT c.id, c.status, c.remaining_usdt, c.payer_address,
               c.escrow_address, c.escrow_private_key_encrypted,
               u.telegram_id as owner_telegram_id
        FROM campaigns c
        JOIN users u ON u.id = c.advertiser_user_id
        WHERE c.id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (Number(campaignRows[0].owner_telegram_id) !== telegramId) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (campaignRows[0].status === 'closed' || campaignRows[0].status === 'cancelled') {
      return res.status(400).json({ error: "Campaign is already closed" });
    }

    const remaining = Number(campaignRows[0].remaining_usdt);
    const payerAddress = campaignRows[0].payer_address;

    // Update status
    await pool.query(
      "UPDATE campaigns SET status = 'closed', updated_at = NOW() WHERE id = $1",
      [campaignId],
    );

    // If there's remaining budget and payer address, trigger refund
    if (remaining > 0 && payerAddress) {
      // Trigger async refund (similar to order refunds)
      safeBackground(async () => {
        try {
          const tonConfig = getTonConfigFromEnv();
          const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
          const refundAmount = toJettonAmount(String(remaining), decimals);
          const refundComment = `campaign_refund_${campaignId}`;

          if (campaignRows[0].escrow_address && campaignRows[0].escrow_private_key_encrypted) {
            const refund = await sendJettonTransferFromEscrow({
              toAddress: payerAddress,
              jettonAmount: refundAmount,
              comment: refundComment,
              escrowAddress: String(campaignRows[0].escrow_address),
              escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
            });
            try {
              const afterSeqno = parseSeqnoFromTxHash(refund.txHash);
              const tonConfig = getTonConfigFromEnv();
              const pendingCount = await getCampaignPendingPayoutCount(campaignId);
              const reserveNano = getCampaignPayoutGasReserveNano(pendingCount);
              const tonBalance = await getAccountTonBalance(
                String(campaignRows[0].escrow_address),
                tonConfig.apiKey,
              );
              const amountNano = (tonBalance - reserveNano).toString();
              await sendTonFromEscrow({
                toAddress: payerAddress,
                escrowAddress: String(campaignRows[0].escrow_address),
                escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
                afterSeqno,
                amountNano,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "TON refund failed";
              await pool.query(
                `
                  UPDATE campaigns
                  SET refund_error = $2, updated_at = NOW()
                  WHERE id = $1
                `,
                [campaignId, `TON refund failed: ${message}`],
              );
            }
          } else {
            await sendJettonTransfer({
              toAddress: payerAddress,
              jettonAmount: refundAmount,
              comment: refundComment,
            });
          }
          await pool.query(
            `
              UPDATE campaigns
              SET
                refund_tx_hash = $2,
                refund_status = 'sent',
                refunded_at = NOW(),
                refund_error = NULL,
                remaining_usdt = 0,
                updated_at = NOW()
              WHERE id = $1
            `,
            [campaignId, `refund_${campaignId}`],
          );
        } catch (err) {
          logger.error("Campaign refund failed", err);
          const message = err instanceof Error ? err.message : "Refund failed";
          await pool.query(
            `
              UPDATE campaigns
              SET refund_status = 'failed', refund_error = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [campaignId, message],
          );
        }
      });
    }

    return res.status(200).json({ ok: true, remainingRefund: remaining });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Cancel campaign (delete, full refund if no accepted applications)
router.delete("/campaigns/:id", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const telegramId = Number(req.body?.telegramId);

    if (!campaignId || !telegramId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Verify ownership
    const { rows: campaignRows } = await pool.query(
      `
        SELECT c.id, c.remaining_usdt, c.budget_usdt, c.payer_address,
               c.escrow_address, c.escrow_private_key_encrypted,
               u.telegram_id as owner_telegram_id
        FROM campaigns c
        JOIN users u ON u.id = c.advertiser_user_id
        WHERE c.id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (Number(campaignRows[0].owner_telegram_id) !== telegramId) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Check if there are accepted applications
    const { rows: acceptedApps } = await pool.query(
      "SELECT COUNT(*) as count FROM campaign_applications WHERE campaign_id = $1 AND status IN ('accepted', 'published')",
      [campaignId],
    );
    const hasAccepted = Number(acceptedApps[0].count) > 0;

    const refundAmount = hasAccepted 
      ? Number(campaignRows[0].remaining_usdt) 
      : Number(campaignRows[0].budget_usdt);
    const payerAddress = campaignRows[0].payer_address;

    // Update status to cancelled
    await pool.query(
      "UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [campaignId],
    );

    // Notify channel owners with accepted/pending applications
    safeBackground(async () => {
      const { rows: appRows } = await pool.query(
        `
          SELECT ca.id, ch.title, ch.username,
                 u.telegram_id AS channel_owner_telegram_id
          FROM campaign_applications ca
          JOIN channels ch ON ch.id = ca.channel_id
          JOIN users u ON u.id = ch.added_by_user_id
          WHERE ca.campaign_id = $1 AND ca.status IN ('pending', 'accepted')
        `,
        [campaignId],
      );
      for (const app of appRows) {
        const channelLabel = app.username ? `@${app.username}` : app.title;
        await notifyUser(
          Number(app.channel_owner_telegram_id),
          `🚫 Кампания #${campaignId} отменена рекламодателем.\nКанал: ${channelLabel}`,
        );
      }
    });

    // Trigger refund
    if (refundAmount > 0 && payerAddress) {
      safeBackground(async () => {
        try {
          const tonConfig = getTonConfigFromEnv();
          const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
          const refundJettonAmount = toJettonAmount(String(refundAmount), decimals);
          const refundComment = `campaign_cancel_${campaignId}`;

          if (campaignRows[0].escrow_address && campaignRows[0].escrow_private_key_encrypted) {
            const refund = await sendJettonTransferFromEscrow({
              toAddress: payerAddress,
              jettonAmount: refundJettonAmount,
              comment: refundComment,
              escrowAddress: String(campaignRows[0].escrow_address),
              escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
            });
            try {
              const afterSeqno = parseSeqnoFromTxHash(refund.txHash);
              const tonConfig = getTonConfigFromEnv();
              const pendingCount = await getCampaignPendingPayoutCount(campaignId);
              const reserveNano = getCampaignPayoutGasReserveNano(pendingCount);
              const tonBalance = await getAccountTonBalance(
                String(campaignRows[0].escrow_address),
                tonConfig.apiKey,
              );
              const amountNano = (tonBalance - reserveNano).toString();
              await sendTonFromEscrow({
                toAddress: payerAddress,
                escrowAddress: String(campaignRows[0].escrow_address),
                escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
                afterSeqno,
                amountNano,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : "TON refund failed";
              await pool.query(
                `
                  UPDATE campaigns
                  SET refund_error = $2, updated_at = NOW()
                  WHERE id = $1
                `,
                [campaignId, `TON refund failed: ${message}`],
              );
            }
          } else {
            await sendJettonTransfer({
              toAddress: payerAddress,
              jettonAmount: refundJettonAmount,
              comment: refundComment,
            });
          }
          await pool.query(
            `
              UPDATE campaigns
              SET
                refund_tx_hash = $2,
                refund_status = 'sent',
                refunded_at = NOW(),
                refund_error = NULL,
                remaining_usdt = 0,
                updated_at = NOW()
              WHERE id = $1
            `,
            [campaignId, `refund_${campaignId}`],
          );
        } catch (err) {
          logger.error("Campaign cancel refund failed", err);
          const message = err instanceof Error ? err.message : "Refund failed";
          await pool.query(
            `
              UPDATE campaigns
              SET refund_status = 'failed', refund_error = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [campaignId, message],
          );
        }
      });
    }

    return res.status(200).json({ ok: true, refundAmount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

router.post("/campaigns/:id/refund", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const telegramId = Number(req.body?.telegramId);

    if (!campaignId || !telegramId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const { rows: campaignRows } = await pool.query(
      `
        SELECT c.id, c.status, c.remaining_usdt, c.payer_address, c.refund_status,
               c.escrow_address, c.escrow_private_key_encrypted,
               u.telegram_id as owner_telegram_id
        FROM campaigns c
        JOIN users u ON u.id = c.advertiser_user_id
        WHERE c.id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (Number(campaignRows[0].owner_telegram_id) !== telegramId) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!["closed", "cancelled"].includes(String(campaignRows[0].status))) {
      return res.status(409).json({ error: "Campaign is not closed" });
    }
    const refundAmount = Number(campaignRows[0].remaining_usdt);
    const payerAddress = campaignRows[0].payer_address;
    if (!payerAddress) {
      return res.status(409).json({ error: "Payer address is missing" });
    }
    const canRefundJetton = refundAmount > 0 && campaignRows[0].refund_status !== "sent";
    if (!canRefundJetton && refundAmount <= 0 && !campaignRows[0].refund_status) {
      return res.status(409).json({ error: "Nothing to refund" });
    }

    const tonConfig = getTonConfigFromEnv();
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const refundJettonAmount = toJettonAmount(String(refundAmount), decimals);
    const refundComment = `campaign_refund_${campaignId}`;

    let tonRefunded = false;
    let tonRefundTxHash: string | null = null;
    let tonRefundAmountNano: string | null = null;
    if (campaignRows[0].escrow_address && campaignRows[0].escrow_private_key_encrypted) {
      let afterSeqno: number | null = null;
      let amountNano: string | undefined;
      if (canRefundJetton) {
        const refund = await sendJettonTransferFromEscrow({
          toAddress: payerAddress,
          jettonAmount: refundJettonAmount,
          comment: refundComment,
          escrowAddress: String(campaignRows[0].escrow_address),
          escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
        });
        afterSeqno = parseSeqnoFromTxHash(refund.txHash);
      }
      try {
        const tonConfig = getTonConfigFromEnv();
        const pendingCount = await getCampaignPendingPayoutCount(campaignId);
        const reserveNano = getCampaignPayoutGasReserveNano(pendingCount);
        const tonBalance = await getAccountTonBalance(
          String(campaignRows[0].escrow_address),
          tonConfig.apiKey,
        );
        amountNano = (tonBalance - reserveNano).toString();
        const tonRefund = await sendTonFromEscrow({
          toAddress: payerAddress,
          escrowAddress: String(campaignRows[0].escrow_address),
          escrowSecretKey: decryptSecret(String(campaignRows[0].escrow_private_key_encrypted)),
          afterSeqno,
          amountNano,
        });
        tonRefunded = Boolean(tonRefund);
        tonRefundTxHash = tonRefund?.txHash ?? null;
        tonRefundAmountNano = tonRefund?.amountNano ?? null;
      } catch (error) {
        const message = error instanceof Error ? error.message : "TON refund failed";
        await pool.query(
          `
            UPDATE campaigns
            SET refund_error = $2, updated_at = NOW()
            WHERE id = $1
          `,
          [campaignId, `TON refund failed: ${message}`],
        );
      }
    } else if (canRefundJetton) {
      await sendJettonTransfer({
        toAddress: payerAddress,
        jettonAmount: refundJettonAmount,
        comment: refundComment,
      });
    }

    if (canRefundJetton) {
      await pool.query(
        `
          UPDATE campaigns
          SET
            refund_tx_hash = $2,
            refund_status = 'sent',
            refunded_at = NOW(),
            refund_error = NULL,
            remaining_usdt = 0,
            updated_at = NOW()
          WHERE id = $1
        `,
        [campaignId, `refund_${campaignId}`],
      );
    }

    return res.status(200).json({
      ok: true,
      tonRefunded,
      tonRefundTxHash,
      tonRefundAmountNano,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refund failed";
    return res.status(400).json({ error: message });
  }
}));

// Confirm campaign payment (called after payment is detected)
router.post("/campaigns/:id/confirm-payment", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const txHash = String(req.body?.txHash ?? "");
    const payerAddress = String(req.body?.payerAddress ?? "");

    if (!campaignId) {
      return res.status(400).json({ error: "Invalid campaign id" });
    }

    const { rows: campaignRows } = await pool.query(
      "SELECT id, status, escrow_address FROM campaigns WHERE id = $1",
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (campaignRows[0].status !== "pending") {
      return res.status(409).json({ error: "Campaign is not pending" });
    }
    if (!campaignRows[0].escrow_address) {
      return res.status(409).json({ error: "Escrow address is missing" });
    }

    const tonConfig = getTonConfigFromEnv();
    const requiredTon = getEscrowRequiredTonMinNano();
    const tonBalance = await getAccountTonBalance(
      String(campaignRows[0].escrow_address),
      tonConfig.apiKey,
    );
    if (tonBalance < requiredTon) {
      return res.status(409).json({
        error: "Escrow TON deposit missing",
        requiredTonNano: requiredTon.toString(),
        currentTonNano: tonBalance.toString(),
      });
    }

    const { rows } = await pool.query(
      `
        UPDATE campaigns
        SET status = 'active', paid_tx_hash = $2, payer_address = $3, paid_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING
          id,
          advertiser_user_id,
          ad_text,
          budget_usdt,
          price_per_post,
          remaining_usdt,
          status,
          payment_reference,
          paid_tx_hash,
          paid_at,
          payer_address,
          created_at,
          updated_at
      `,
      [campaignId, txHash || null, payerAddress || null],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found or already active" });
    }

    return res.status(200).json({ campaign: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

const refreshCampaignPayment = async (campaignId: number) => {
  if (!campaignId) {
    return { status: 400, body: { error: "Invalid campaign id" } };
  }

  let tonConfig;
  try {
    tonConfig = getTonConfigFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : "TonAPI config error";
    return { status: 500, body: { error: message } };
  }

  const { rows: campaignRows } = await pool.query(
    `
      SELECT
        id,
        status,
        budget_usdt,
        payment_reference,
        escrow_address,
        escrow_address_raw,
        paid_tx_hash,
        payer_address
      FROM campaigns
      WHERE id = $1
    `,
    [campaignId],
  );

  if (campaignRows.length === 0) {
    return { status: 404, body: { error: "Campaign not found" } };
  }

  const campaign = campaignRows[0];
  if (campaign.status === "active") {
    return { status: 200, body: { campaign } };
  }
  if (!campaign.payment_reference) {
    return { status: 409, body: { error: "Payment reference is missing" } };
  }
  if (!campaign.escrow_address) {
    return { status: 409, body: { error: "Escrow address is missing" } };
  }

  const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
  const expectedAmount = toJettonAmount(String(campaign.budget_usdt), decimals);
  const expectedAddresses = new Set<string>();
  expectedAddresses.add(normalizeTonAddress(campaign.escrow_address));
  if (campaign.escrow_address_raw) {
    expectedAddresses.add(normalizeTonAddress(campaign.escrow_address_raw));
  }
  if (tonConfig.usdtJettonWallet) {
    expectedAddresses.add(normalizeTonAddress(tonConfig.usdtJettonWallet));
  }
  if (tonConfig.usdtJettonWalletRaw) {
    expectedAddresses.add(normalizeTonAddress(tonConfig.usdtJettonWalletRaw));
  }

  const expectedJettonMasters = new Set<string>();
  expectedJettonMasters.add(normalizeTonAddress(tonConfig.usdtJettonMaster));
  if (tonConfig.usdtJettonMasterRaw) {
    expectedJettonMasters.add(normalizeTonAddress(tonConfig.usdtJettonMasterRaw));
  }

  const events = await getAccountEvents(campaign.escrow_address, tonConfig.apiKey, 50);

  let matchedTransfer:
    | {
        sender?: string;
        txHashes: string[];
        timestamp?: number;
      }
    | undefined;

  for (const event of events) {
    for (const action of event.actions ?? []) {
      const transfer = action.JettonTransfer;
      if (!transfer) {
        continue;
      }
      const recipient = normalizeTonAddress(transfer.recipient?.address ?? "");
      const recipientWallet = normalizeTonAddress(transfer.recipients_wallet ?? "");
      const jettonMaster = normalizeTonAddress(
        transfer.jetton?.address ?? transfer.jetton_master ?? "",
      );
      const amount = String(transfer.amount ?? "");
      const comment = String(transfer.comment ?? "");

      if (
        (!recipient && !recipientWallet) ||
        (!expectedAddresses.has(recipient) && !expectedAddresses.has(recipientWallet))
      ) {
        continue;
      }
      if (jettonMaster && !expectedJettonMasters.has(jettonMaster)) {
        continue;
      }
      if (amount !== expectedAmount) {
        continue;
      }
      if (!comment || !comment.includes(String(campaign.payment_reference))) {
        continue;
      }

      const txHashes = [
        transfer.transaction?.hash,
        transfer.tx_hash,
        event.event_id,
        ...(event.base_transactions ?? []),
      ].filter((value): value is string => Boolean(value));

      matchedTransfer = {
        sender: transfer.sender?.address,
        txHashes,
        timestamp: event.timestamp,
      };
      break;
    }
    if (matchedTransfer) {
      break;
    }
  }

  if (!matchedTransfer) {
    return {
      status: 404,
      body: {
        error: "Matching on-chain transfer not found yet",
        expected: {
          escrowAddress: campaign.escrow_address,
          jettonMaster: tonConfig.usdtJettonMaster,
          amount: expectedAmount,
          comment: campaign.payment_reference,
          recipientAliases: Array.from(expectedAddresses),
          jettonMasterAliases: Array.from(expectedJettonMasters),
        },
      },
    };
  }

  const requiredTon = getEscrowRequiredTonMinNano();
  const tonBalance = await getAccountTonBalance(campaign.escrow_address, tonConfig.apiKey);
  if (tonBalance < requiredTon) {
    return {
      status: 409,
      body: {
        error: "Escrow TON deposit missing",
        requiredTonNano: requiredTon.toString(),
        currentTonNano: tonBalance.toString(),
      },
    };
  }

  let confirmations = 0;
  if (matchedTransfer.txHashes.length > 0) {
    const headSeqno = await getMasterchainSeqno(tonConfig.apiKey);
    for (const txHash of matchedTransfer.txHashes) {
      const txSeqno = await getTransactionSeqno(txHash, tonConfig.apiKey);
      if (txSeqno) {
        confirmations = Math.max(headSeqno - txSeqno + 1, 0);
        break;
      }
    }
  }

  if (confirmations === 0 && matchedTransfer.timestamp) {
    const elapsedSeconds = Math.max(
      Math.floor(Date.now() / 1000) - matchedTransfer.timestamp,
      0,
    );
    const requiredSeconds =
      tonConfig.confirmationsRequired * tonConfig.blockTimeSeconds;
    if (elapsedSeconds >= requiredSeconds) {
      confirmations = tonConfig.confirmationsRequired;
    }
  }

  if (confirmations < tonConfig.confirmationsRequired) {
    return {
      status: 200,
      body: {
        campaignId,
        status: "pending",
        confirmations,
        requiredConfirmations: tonConfig.confirmationsRequired,
      },
    };
  }

  const txHash =
    matchedTransfer.txHashes.find(Boolean) ?? `event:${campaign.payment_reference}`;

  const { rows: updatedRows } = await pool.query(
    `
      UPDATE campaigns
      SET status = 'active',
          paid_tx_hash = $2,
          payer_address = $3,
          paid_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING
        id,
        advertiser_user_id,
        ad_text,
        budget_usdt,
        price_per_post,
        remaining_usdt,
        status,
        payment_reference,
        paid_tx_hash,
        paid_at,
        payer_address,
        created_at,
        updated_at
    `,
    [campaignId, txHash, matchedTransfer.sender ?? null],
  );

  if (updatedRows.length === 0) {
    return { status: 409, body: { error: "Campaign is not pending" } };
  }

  return { status: 200, body: { campaign: updatedRows[0] } };
};

// Refresh campaign payment status by checking on-chain transfer
router.post("/campaigns/:id/refresh", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const result = await refreshCampaignPayment(campaignId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
}));

// Lookup campaign by payment reference/comment
router.get("/campaigns/by-reference/:reference", asyncHandler(async (req, res) => {
  const reference = String(req.params.reference ?? "").trim();
  if (!reference) {
    return res.status(400).json({ error: "reference is required" });
  }

  const { rows } = await pool.query(
    `
      SELECT
        id,
        status,
        payment_reference,
        escrow_address,
        paid_tx_hash,
        paid_at,
        payer_address,
        created_at
      FROM campaigns
      WHERE payment_reference = $1
      LIMIT 1
    `,
    [reference],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  return res.status(200).json({ campaign: rows[0] });
}));

router.post("/campaigns/:id/txrequest", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const walletAddress = String(req.body?.walletAddress ?? "").trim();
    if (!campaignId) {
      return res.status(400).json({ error: "Invalid campaign id" });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const { rows: campaignRows } = await pool.query(
      `
        SELECT
          id,
          status,
          budget_usdt,
          payment_reference,
          escrow_address
        FROM campaigns
        WHERE id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (!campaignRows[0].escrow_address) {
      return res.status(409).json({ error: "Escrow address is missing" });
    }
    if (!campaignRows[0].payment_reference) {
      return res.status(409).json({ error: "Payment reference is missing" });
    }

    const tonConfig = getTonConfigFromEnv();
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const jettonAmount = toJettonAmount(String(campaignRows[0].budget_usdt), decimals);
    const userJettonWallet = await getJettonWalletAddress(
      walletAddress,
      tonConfig.usdtJettonMaster,
      tonConfig.apiKey,
    );
    if (!userJettonWallet) {
      return res.status(409).json({ error: "User jetton wallet not found" });
    }

    const payload = buildJettonTransferPayload({
      toAddress: String(campaignRows[0].escrow_address),
      responseAddress: walletAddress,
      jettonAmount,
      comment: String(campaignRows[0].payment_reference),
    });

    const tx = {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [
        {
          address: String(campaignRows[0].escrow_address),
          amount: getEscrowRequiredTonNano().toString(),
        },
        {
          address: userJettonWallet,
          amount: getJettonGasNano().toString(),
          payload,
        },
      ],
    };

    return res.status(200).json({ tx });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Txrequest failed";
    return res.status(400).json({ error: message });
  }
}));

router.post("/campaigns/:id/tonkeeper-link", asyncHandler(async (req, res) => {
  try {
    const campaignId = requireIntParam(req.params.id, "id");
    const walletAddress = String(req.body?.walletAddress ?? "").trim();
    if (!campaignId) {
      return res.status(400).json({ error: "Invalid campaign id" });
    }
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const { rows: campaignRows } = await pool.query(
      `
        SELECT
          id,
          budget_usdt,
          payment_reference,
          escrow_address
        FROM campaigns
        WHERE id = $1
      `,
      [campaignId],
    );
    if (campaignRows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    if (!campaignRows[0].escrow_address) {
      return res.status(409).json({ error: "Escrow address is missing" });
    }
    if (!campaignRows[0].payment_reference) {
      return res.status(409).json({ error: "Payment reference is missing" });
    }

    const tonConfig = getTonConfigFromEnv();
    const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
    const jettonAmount = toJettonAmount(String(campaignRows[0].budget_usdt), decimals);
    const userJettonWallet = await getJettonWalletAddress(
      walletAddress,
      tonConfig.usdtJettonMaster,
      tonConfig.apiKey,
    );
    if (!userJettonWallet) {
      return res.status(409).json({ error: "User jetton wallet not found" });
    }

    const requiredTon = getEscrowRequiredTonNano();
    const bufferTon = getEscrowTonBufferNano();
    const payload = buildJettonTransferPayload({
      toAddress: String(campaignRows[0].escrow_address),
      responseAddress: walletAddress,
      jettonAmount,
      comment: String(campaignRows[0].payment_reference),
      forwardTonAmountNano: requiredTon.toString(),
    });
    const tonAmount = requiredTon + getJettonGasNano() + bufferTon;

    const params = new URLSearchParams({
      amount: tonAmount.toString(),
      bin: base64Url(payload),
    });
    const tonkeeperUrl = `https://app.tonkeeper.com/transfer/${userJettonWallet}?${params.toString()}`;

    return res.status(200).json({
      tonkeeperUrl,
      requiredTonNano: requiredTon.toString(),
      bufferTonNano: bufferTon.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tonkeeper link failed";
    return res.status(400).json({ error: message });
  }
}));

// Get my channel applications to campaigns
router.get("/campaigns/applications/my/:telegramId", asyncHandler(async (req, res) => {
  const telegramId = requireIntParam(req.params.telegramId, "telegramId");
  if (req.telegramId && req.telegramId !== telegramId) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { rows } = await pool.query(
    `
      SELECT 
        ca.*,
        c.ad_text as campaign_ad_text,
        c.budget_usdt as campaign_budget_usdt,
        c.price_per_post as campaign_price_per_post,
        c.remaining_usdt,
        c.status as campaign_status,
        ch.title as channel_title,
        ch.username as channel_username
      FROM campaign_applications ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN channels ch ON ch.id = ca.channel_id
      JOIN users u ON u.id = ch.added_by_user_id
      WHERE u.telegram_id = $1
      ORDER BY ca.created_at DESC
    `,
    [telegramId],
  );

  return res.status(200).json({ applications: rows });
}));

// ─── Background Jobs ─────────────────────────────────────────────────

export const processPendingCampaignPayments = async () => {
  const { rows } = await pool.query(
    `
      SELECT id
      FROM campaigns
      WHERE status = 'pending'
        AND payment_reference IS NOT NULL
        AND escrow_address IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 25
    `,
  );

  for (const row of rows) {
    try {
      await refreshCampaignPayment(Number(row.id));
    } catch (error) {
      logger.error("Failed to refresh campaign payment", row.id, error);
    }
  }
};

export const processCampaignApplicationPayouts = async () => {
  const { rows } = await pool.query(
    `
      SELECT
        ca.id,
        ca.campaign_id,
        ca.channel_id,
        ca.proposed_price,
        ca.published_message_id,
        ca.payout_ready_at,
        ca.payout_status,
        ca.payout_tx_hash,
        c.price_per_post,
        c.escrow_address,
        c.escrow_private_key_encrypted,
        ch.telegram_id AS channel_telegram_id,
        ch.payout_address
      FROM campaign_applications ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN channels ch ON ch.id = ca.channel_id
      WHERE ca.status = 'published'
        AND ca.published_message_id IS NOT NULL
        AND ca.payout_ready_at IS NOT NULL
        AND ca.payout_ready_at <= NOW()
        AND (
          ca.payout_status IS NULL
          OR ca.payout_status = 'verification_pending'
          OR (ca.payout_status = 'failed' AND ca.payout_error = 'BOT_LOG_CHAT_ID is not set')
        )
        AND ca.payout_tx_hash IS NULL
      ORDER BY ca.payout_ready_at ASC
      LIMIT 25
    `,
  );

  for (const row of rows) {
    const { rows: updatedRows } = await pool.query(
      `
        UPDATE campaign_applications
        SET payout_status = 'verifying', payout_error = NULL, updated_at = NOW()
        WHERE id = $1
          AND (
            payout_status IS NULL
            OR payout_status = 'verification_pending'
            OR (payout_status = 'failed' AND payout_error = 'BOT_LOG_CHAT_ID is not set')
          )
        RETURNING id
      `,
      [row.id],
    );
    if (updatedRows.length === 0) {
      continue;
    }

    const channelId = String(row.channel_telegram_id);
    const messageId = Number(row.published_message_id);
    let exists = false;
    try {
      exists = await checkMessageExists(botToken, channelId, messageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      if (isRetryAfterError(message)) {
        await pool.query(
          `
            UPDATE campaign_applications
            SET payout_status = 'verification_pending', payout_error = $2, updated_at = NOW()
            WHERE id = $1
          `,
          [row.id, message],
        );
        continue;
      }
      await pool.query(
        `
          UPDATE campaign_applications
          SET payout_status = 'failed', payout_error = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, message],
      );
      continue;
    }

    if (!exists) {
      safeBackground(async () => {
        const targets = await getCampaignNotificationTargets(Number(row.id));
        if (!targets) {
          return;
        }
        const channelLabel = targets.channel_username
          ? `@${targets.channel_username}`
          : targets.channel_title;
        await notifyUser(
          Number(targets.channel_owner_telegram_id),
          `⚠️ Пост удалён по кампании #${targets.campaign_id}. Заявка возвращена в accepted.\n` +
            `Канал: ${channelLabel}`,
        );
        await notifyUser(
          Number(targets.advertiser_telegram_id),
          `⚠️ Пост удалён по кампании #${targets.campaign_id}. Заявка возвращена в accepted.`,
        );
      });
      await pool.query(
        `
          UPDATE campaign_applications
          SET
            status = 'accepted',
            published_message_id = NULL,
            published_at = NULL,
            verify_status = 'deleted',
            verified_at = NOW(),
            verify_error = 'message deleted',
            payout_status = 'cancelled',
            payout_error = 'message deleted',
            payout_ready_at = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    await pool.query(
      `
        UPDATE campaign_applications
        SET
          verify_status = 'passed',
          verified_at = NOW(),
          verify_error = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [row.id],
    );

    if (!row.payout_address) {
      await pool.query(
        `
          UPDATE campaign_applications
          SET payout_status = 'failed', payout_error = 'payout_address is missing', updated_at = NOW()
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    if (!row.escrow_address || !row.escrow_private_key_encrypted) {
      await pool.query(
        `
          UPDATE campaign_applications
          SET payout_status = 'failed', payout_error = 'escrow is missing', updated_at = NOW()
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    const price =
      Number(row.proposed_price ?? 0) || Number(row.price_per_post ?? 0) || 0;
    if (price <= 0) {
      await pool.query(
        `
          UPDATE campaign_applications
          SET payout_status = 'failed', payout_error = 'price is missing', updated_at = NOW()
          WHERE id = $1
        `,
        [row.id],
      );
      continue;
    }

    try {
      const tonConfig = getTonConfigFromEnv();
      const decimals = await getJettonDecimals(tonConfig.usdtJettonMaster, tonConfig.apiKey);
      const { payoutUsdt, commissionUsdt } = splitPayoutAmount(String(price));
      const payoutAmount = toJettonAmount(payoutUsdt, decimals);
      const commissionAmount = toJettonAmount(commissionUsdt, decimals);
      const payoutComment = `campaign_payout_${row.campaign_id}_${row.id}`;
      const commissionComment = `campaign_commission_${row.campaign_id}_${row.id}`;
      const escrowAddress = String(row.escrow_address);
      const escrowSecret = decryptSecret(String(row.escrow_private_key_encrypted));

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
        toAddress: String(row.payout_address),
        jettonAmount: payoutAmount,
        comment: payoutComment,
        escrowAddress,
        escrowSecretKey: escrowSecret,
      });

      await pool.query(
        `
          UPDATE campaign_applications
          SET
            payout_status = 'sent',
            payout_tx_hash = $2,
            payout_at = NOW(),
            payout_error = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, payout.txHash],
      );

      safeBackground(async () => {
        const targets = await getCampaignNotificationTargets(Number(row.id));
        if (!targets) {
          return;
        }
        const channelLabel = targets.channel_username
          ? `@${targets.channel_username}`
          : targets.channel_title;
        await notifyUser(
          Number(targets.channel_owner_telegram_id),
          `💸 Выплата отправлена по кампании #${targets.campaign_id}.\n` +
            `Канал: ${channelLabel}\n` +
            `Сумма: ${price} USDT`,
        );
        await notifyUser(
          Number(targets.advertiser_telegram_id),
          `✅ Выплата отправлена по кампании #${targets.campaign_id}.\nСумма: ${price} USDT`,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Campaign payout failed";
      await pool.query(
        `
          UPDATE campaign_applications
          SET payout_status = 'failed', payout_error = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, message],
      );
    }
  }
};

export default router;
