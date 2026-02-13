import { Router } from "express";
import { pool } from "../db";
import { getBotUser, getChatMember, sendMessage } from "../telegramBot";
import {
  botToken,
  isRetryAfterError,
  getPayoutDelayMinutes,
  triggerRefund,
  publishCampaignApplicationInternal,
  getCampaignNotificationTargets,
  notifyUser,
  safeBackground,
  requireIntParam,
} from "../helpers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.get("/orders/paid/:telegramId", asyncHandler(async (req, res) => {
  const telegramId = requireIntParam(req.params.telegramId, "telegramId");
  if (req.telegramId && req.telegramId !== telegramId) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { rows } = await pool.query(
    `
      SELECT
        og.id AS group_id,
        og.created_at AS group_created_at,
        p.id AS payment_id,
        p.status AS payment_status,
        p.total_usdt,
        p.refund_status,
        p.refund_tx_hash,
        p.refund_error,
        p.payout_status,
        p.payout_ready_at,
        p.payout_tx_hash,
        p.payout_error,
        o.id AS order_id,
        o.ad_text,
        o.publish_at,
        o.published_message_id,
        o.published_channel_id,
        o.published_at,
        o.publish_status,
        o.publish_error,
        o.verify_status,
        o.verified_at,
        o.verify_error,
        o.price_usdt,
        c.title,
        c.username
      FROM order_groups og
      JOIN payments p ON p.order_group_id = og.id
      JOIN orders o ON o.group_id = og.id
      LEFT JOIN channels c ON c.telegram_id = o.channel_telegram_id
      WHERE og.telegram_id = $1
        AND p.status IN ('paid', 'rejected', 'accepted')
      ORDER BY og.created_at DESC, o.created_at DESC
    `,
    [telegramId],
  );

  const groups = new Map<
    number,
    {
      groupId: number;
      createdAt: string;
      paymentId: number;
      paymentStatus: string;
      totalUsdt: string | null;
      refundStatus: string | null;
      refundTxHash: string | null;
      refundError: string | null;
      payoutStatus: string | null;
      payoutReadyAt: string | null;
      payoutTxHash: string | null;
      payoutError: string | null;
      items: Array<{
        id: number;
        source?: "orders" | "campaign";
        campaignId?: number | null;
        adText: string;
        publishAt: string;
        publishedMessageId: number | null;
        publishedChannelId: string | null;
        publishedAt: string | null;
        publishStatus: string | null;
        publishError: string | null;
        verifyStatus: string | null;
        verifiedAt: string | null;
        verifyError: string | null;
        payoutStatus?: string | null;
        payoutReadyAt?: string | null;
        payoutTxHash?: string | null;
        payoutError?: string | null;
        priceUsdt: string | null;
        title: string | null;
        username: string | null;
      }>;
    }
  >();

  for (const row of rows) {
    const groupId = Number(row.group_id);
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        createdAt: new Date(row.group_created_at).toISOString(),
        paymentId: Number(row.payment_id),
        paymentStatus: String(row.payment_status),
        totalUsdt: row.total_usdt ? String(row.total_usdt) : null,
        refundStatus: row.refund_status ? String(row.refund_status) : null,
        refundTxHash: row.refund_tx_hash ? String(row.refund_tx_hash) : null,
        refundError: row.refund_error ? String(row.refund_error) : null,
        payoutStatus: row.payout_status ? String(row.payout_status) : null,
        payoutReadyAt: row.payout_ready_at
          ? new Date(row.payout_ready_at).toISOString()
          : null,
        payoutTxHash: row.payout_tx_hash ? String(row.payout_tx_hash) : null,
        payoutError: row.payout_error ? String(row.payout_error) : null,
        items: [],
      });
    }

    groups.get(groupId)?.items.push({
      id: Number(row.order_id),
      source: "orders",
      campaignId: null,
      adText: String(row.ad_text),
      publishAt: new Date(row.publish_at).toISOString(),
      publishedMessageId: row.published_message_id
        ? Number(row.published_message_id)
        : null,
      publishedChannelId: row.published_channel_id
        ? String(row.published_channel_id)
        : null,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      publishStatus: row.publish_status ? String(row.publish_status) : null,
      publishError: row.publish_error ? String(row.publish_error) : null,
      verifyStatus: row.verify_status ? String(row.verify_status) : null,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      verifyError: row.verify_error ? String(row.verify_error) : null,
      priceUsdt: row.price_usdt ? String(row.price_usdt) : null,
      title: row.title ? String(row.title) : null,
      username: row.username ? String(row.username) : null,
    });
  }

  const { rows: campaignRows } = await pool.query(
    `
      SELECT
        ca.id AS application_id,
        ca.status AS application_status,
        ca.published_message_id,
        ca.published_at,
        ca.verify_status,
        ca.verified_at,
        ca.verify_error,
        ca.payout_ready_at,
        ca.payout_status,
        ca.payout_tx_hash,
        ca.payout_error,
        ca.created_at AS application_created_at,
        c.id AS campaign_id,
        c.ad_text,
        c.price_per_post,
        c.created_at AS campaign_created_at,
        ch.telegram_id AS channel_telegram_id,
        ch.title,
        ch.username
      FROM campaign_applications ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN channels ch ON ch.id = ca.channel_id
      JOIN users u ON u.id = ch.added_by_user_id
      WHERE u.telegram_id = $1
        AND ca.status IN ('accepted', 'published')
      ORDER BY ca.created_at DESC
    `,
    [telegramId],
  );

  for (const row of campaignRows) {
    const groupId = -Number(row.campaign_id);
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        createdAt: new Date(row.campaign_created_at).toISOString(),
        paymentId: 0,
        paymentStatus: "accepted",
        totalUsdt: null,
        refundStatus: null,
        refundTxHash: null,
        refundError: null,
        payoutStatus: null,
        payoutReadyAt: null,
        payoutTxHash: null,
        payoutError: null,
        items: [],
      });
    }

    const publishAt = row.application_created_at
      ? new Date(row.application_created_at).toISOString()
      : new Date().toISOString();
    const publishStatus =
      row.application_status === "published" ? "published" : "pending";

    groups.get(groupId)?.items.push({
      id: Number(row.application_id),
      source: "campaign",
      campaignId: Number(row.campaign_id),
      adText: String(row.ad_text),
      publishAt,
      publishedMessageId: row.published_message_id
        ? Number(row.published_message_id)
        : null,
      publishedChannelId: row.channel_telegram_id
        ? String(row.channel_telegram_id)
        : null,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      publishStatus,
      publishError: null,
      verifyStatus: row.verify_status ? String(row.verify_status) : null,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      verifyError: row.verify_error ? String(row.verify_error) : null,
      payoutReadyAt: row.payout_ready_at
        ? new Date(row.payout_ready_at).toISOString()
        : null,
      payoutStatus: row.payout_status ? String(row.payout_status) : null,
      payoutTxHash: row.payout_tx_hash ? String(row.payout_tx_hash) : null,
      payoutError: row.payout_error ? String(row.payout_error) : null,
      priceUsdt: row.price_per_post ? String(row.price_per_post) : null,
      title: row.title ? String(row.title) : null,
      username: row.username ? String(row.username) : null,
    });
  }

  return res.status(200).json({ groups: Array.from(groups.values()) });
}));

router.post("/orders/:orderId/publish", asyncHandler(async (req, res) => {
  try {
    const orderId = requireIntParam(req.params.orderId, "orderId");
    const telegramId = Number(req.body?.telegramId);
    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    const { rows } = await pool.query(
      `
        WITH latest_payment AS (
          SELECT *
          FROM payments
          WHERE order_group_id = (SELECT group_id FROM orders WHERE id = $1)
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT
          o.id AS order_id,
          o.group_id,
          o.channel_telegram_id,
          o.ad_text,
          o.published_message_id,
          o.publish_status,
          o.verify_status,
          p.id AS payment_id,
          p.status AS payment_status,
          p.payout_status,
          p.payout_ready_at
        FROM orders o
        JOIN latest_payment p ON p.order_group_id = o.group_id
        WHERE o.id = $1
      `,
      [orderId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = rows[0];
    if (order.payment_status !== "paid" && order.payment_status !== "accepted") {
      return res.status(409).json({ error: "Payment is not paid yet" });
    }
    if (order.published_message_id) {
      return res.status(409).json({ error: "Order already published" });
    }

    const channelId = String(order.channel_telegram_id);
    const member = await getChatMember(botToken, channelId, telegramId);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    if (!isAdmin) {
      return res.status(403).json({ error: "User is not a channel admin" });
    }

    const botUser = await getBotUser(botToken);
    const botMember = await getChatMember(botToken, channelId, botUser.id);
    if (botMember.status !== "administrator") {
      return res.status(403).json({ error: "Bot is not a channel admin" });
    }
    if (botMember.can_post_messages === false) {
      return res.status(403).json({ error: "Bot cannot post messages in this channel" });
    }

    let message;
    try {
      message = await sendMessage(botToken, channelId, String(order.ad_text));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Publish failed";
      if (isRetryAfterError(messageText)) {
        return res.status(429).json({ error: messageText });
      }
      await pool.query(
        `
          UPDATE orders
          SET publish_status = 'failed', publish_error = $2
          WHERE id = $1
        `,
        [orderId, messageText],
      );
      return res.status(400).json({ error: messageText });
    }

    const { rows: updatedOrders } = await pool.query(
      `
        UPDATE orders
        SET
          published_message_id = $2,
          published_channel_id = $3,
          published_at = NOW(),
          publish_status = 'published',
          publish_error = NULL,
          verify_status = 'pending',
          verify_error = NULL
        WHERE id = $1
        RETURNING
          id,
          published_message_id,
          published_channel_id,
          published_at,
          publish_status,
          verify_status
      `,
      [orderId, message.message_id, order.channel_telegram_id],
    );

    let updatedPayment = null;
    try {
      const payoutDelayMinutes = getPayoutDelayMinutes();
      const { rows: paymentRows } = await pool.query(
        `
          UPDATE payments
          SET
            status = CASE WHEN status = 'paid' THEN 'accepted' ELSE status END,
            payout_status = 'verification_pending',
            payout_ready_at = NOW() + ($2 || ' minutes')::interval,
            payout_error = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, status, payout_status, payout_ready_at
        `,
        [order.payment_id, payoutDelayMinutes],
      );
      updatedPayment = paymentRows[0] ?? null;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to schedule payout";
      await pool.query(
        `
          UPDATE orders
          SET publish_error = $2
          WHERE id = $1
        `,
        [orderId, messageText],
      );
    }

    return res.status(200).json({
      order: updatedOrders[0],
      payment: updatedPayment,
      messageId: message.message_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    if (isRetryAfterError(message)) {
      return res.status(429).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
}));

router.post("/campaigns/applications/:appId/publish", asyncHandler(async (req, res) => {
  try {
    const appId = requireIntParam(req.params.appId, "appId");
    const telegramId = Number(req.body?.telegramId);
    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    const result = await publishCampaignApplicationInternal(appId, telegramId);

    safeBackground(async () => {
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
    });

    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    if (isRetryAfterError(message)) {
      return res.status(429).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
}));

router.post("/orders/:orderId/reject", asyncHandler(async (req, res) => {
  try {
    const orderId = requireIntParam(req.params.orderId, "orderId");
    const telegramId = Number(req.body?.telegramId);
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    const { rows } = await pool.query(
      `
        WITH latest_payment AS (
          SELECT *
          FROM payments
          WHERE order_group_id = (SELECT group_id FROM orders WHERE id = $1)
          ORDER BY created_at DESC
          LIMIT 1
        )
        SELECT
          o.id AS order_id,
          o.channel_telegram_id,
          p.id AS payment_id,
          p.status AS payment_status,
          p.total_usdt,
          p.payer_address,
          p.reference,
          p.refund_tx_hash,
          p.refund_status
        FROM orders o
        JOIN latest_payment p ON p.order_group_id = o.group_id
        WHERE o.id = $1
      `,
      [orderId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = rows[0];
    if (order.payment_status !== "paid" && order.payment_status !== "accepted") {
      return res.status(409).json({ error: "Payment is not paid yet" });
    }

    const channelId = String(order.channel_telegram_id);
    const member = await getChatMember(botToken, channelId, telegramId);
    const isAdmin = member.status === "administrator" || member.status === "creator";
    if (!isAdmin) {
      return res.status(403).json({ error: "User is not a channel admin" });
    }

    if (!order.payer_address) {
      return res.status(409).json({ error: "payer_address is missing" });
    }
    if (order.refund_tx_hash || order.refund_status === "pending") {
      return res.status(409).json({ error: "Refund already sent" });
    }

    await pool.query(
      `
        UPDATE orders
        SET
          publish_status = 'rejected',
          publish_error = $2
        WHERE id = $1
      `,
      [orderId, reason || "rejected by admin"],
    );

    const { rows: updatedRows } = await pool.query(
      `
        UPDATE payments
        SET
          status = 'rejected',
          refund_status = 'pending',
          payout_status = 'cancelled',
          payout_error = 'rejected by admin',
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          order_group_id,
          status,
          amount_usdt,
          fee_usdt,
          total_usdt,
          reference,
          provider,
          escrow_address,
          external_id,
          payer_address,
          paid_tx_hash,
          paid_at,
          confirmations,
          refund_tx_hash,
          refunded_at,
          refund_status,
          refund_error,
          payout_status,
          payout_ready_at,
          payout_tx_hash,
          payout_error,
          created_at,
          updated_at
      `,
      [order.payment_id],
    );

    const { rows: escrowRows } = await pool.query(
      "SELECT escrow_address, escrow_private_key_encrypted FROM payments WHERE id = $1",
      [order.payment_id],
    );
    const escrow = escrowRows[0] ?? {};

    triggerRefund({
      paymentId: Number(order.payment_id),
      payerAddress: String(order.payer_address),
      totalUsdt: String(order.total_usdt),
      reference: order.reference ? String(order.reference) : null,
      escrowAddress: escrow.escrow_address ?? null,
      escrowSecretEncrypted: escrow.escrow_private_key_encrypted ?? null,
    });

    return res.status(200).json({ payment: updatedRows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reject failed";
    if (isRetryAfterError(message)) {
      return res.status(429).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
}));

export default router;
