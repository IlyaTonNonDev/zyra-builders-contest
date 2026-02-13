import { Router } from "express";
import { pool } from "../db";
import { requireIntParam } from "../helpers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.post("/cart/items", asyncHandler(async (req, res) => {
  const telegramId = Number(req.body?.telegramId);
  const channelTelegramId = Number(req.body?.channelTelegramId);
  const adText = String(req.body?.adText ?? "").trim();
  const publishAtRaw = String(req.body?.publishAt ?? "");

  if (!telegramId || !channelTelegramId || !adText || !publishAtRaw) {
    return res
      .status(400)
      .json({ error: "telegramId, channelTelegramId, adText, publishAt are required" });
  }

  const publishAt = new Date(publishAtRaw);
  if (Number.isNaN(publishAt.getTime())) {
    return res.status(400).json({ error: "Invalid publishAt" });
  }

  const { rows: channelRows } = await pool.query(
    "SELECT price_usdt FROM channels WHERE telegram_id = $1",
    [channelTelegramId],
  );
  if (channelRows.length === 0) {
    return res.status(404).json({ error: "Channel not found" });
  }

  const { rows: groupRows } = await pool.query(
    `
      SELECT id
      FROM order_groups
      WHERE telegram_id = $1 AND status = 'draft'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [telegramId],
  );

  const groupId =
    groupRows.length > 0
      ? groupRows[0].id
      : (
          await pool.query(
            "INSERT INTO order_groups (telegram_id) VALUES ($1) RETURNING id",
            [telegramId],
          )
        ).rows[0].id;

  const { rows } = await pool.query(
    `
      INSERT INTO orders (group_id, channel_telegram_id, ad_text, publish_at, price_usdt)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, channel_telegram_id, ad_text, publish_at, price_usdt, created_at
    `,
    [groupId, channelTelegramId, adText, publishAt, channelRows[0].price_usdt],
  );

  return res.status(200).json({ groupId, order: rows[0] });
}));

router.delete("/cart/items/:orderId", asyncHandler(async (req, res) => {
  const orderId = requireIntParam(req.params.orderId, "orderId");

  const { rows } = await pool.query(
    `
      DELETE FROM orders
      USING order_groups
      WHERE orders.id = $1
        AND orders.group_id = order_groups.id
        AND order_groups.status = 'draft'
      RETURNING orders.id, orders.group_id
    `,
    [orderId],
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Order not found or not in draft" });
  }

  return res.status(200).json({ orderId: rows[0].id, groupId: rows[0].group_id });
}));

router.get("/cart/:telegramId", asyncHandler(async (req, res) => {
  const telegramId = requireIntParam(req.params.telegramId, "telegramId");
  if (req.telegramId && req.telegramId !== telegramId) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { rows: groupRows } = await pool.query(
    `
      SELECT id
      FROM order_groups
      WHERE telegram_id = $1 AND status = 'draft'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [telegramId],
  );

  if (groupRows.length === 0) {
    return res.status(200).json({ groupId: null, items: [] });
  }

  const { rows } = await pool.query(
    `
      SELECT
        o.id,
        o.channel_telegram_id,
        o.ad_text,
        o.publish_at,
        o.created_at,
        o.price_usdt,
        c.title,
        c.username
      FROM orders o
      LEFT JOIN channels c ON c.telegram_id = o.channel_telegram_id
      WHERE o.group_id = $1
      ORDER BY o.created_at DESC
    `,
    [groupRows[0].id],
  );

  return res.status(200).json({ groupId: groupRows[0].id, items: rows });
}));

router.post("/cart/checkout", asyncHandler(async (req, res) => {
  const telegramId = Number(req.body?.telegramId);
  if (!telegramId) {
    return res.status(400).json({ error: "telegramId is required" });
  }

  const { rows: groupRows } = await pool.query(
    `
      SELECT id
      FROM order_groups
      WHERE telegram_id = $1 AND status = 'draft'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [telegramId],
  );

  if (groupRows.length === 0) {
    return res.status(404).json({ error: "Draft group not found" });
  }

  await pool.query("UPDATE order_groups SET status = 'pending_payment' WHERE id = $1", [
    groupRows[0].id,
  ]);

  return res.status(200).json({ groupId: groupRows[0].id, status: "pending_payment" });
}));

export default router;
