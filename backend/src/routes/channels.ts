import { Router } from "express";
import { Address } from "@ton/core";
import { pool } from "../db";
import { getChat, getBotUser, getChatMember } from "../telegramBot";
import {
  botToken,
  allowedTopics,
  updateChannelStats,
  requireIntParam,
} from "../helpers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

/**
 * Нормализует ввод канала: @username, ссылки t.me, просто username → @username
 */
function normalizeChannelInput(raw: string): string {
  let value = raw.trim();

  // https://t.me/username или http://t.me/username
  const linkMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)/);
  if (linkMatch) {
    return `@${linkMatch[1]}`;
  }

  // Уже с @ — вернуть как есть
  if (value.startsWith("@")) {
    return value;
  }

  // Числовой ID (отрицательный) — вернуть как есть
  if (/^-?\d+$/.test(value)) {
    return value;
  }

  // Просто username без @ — добавить @
  return `@${value}`;
}

router.post(
  "/channels/register",
  asyncHandler(async (req, res) => {
    try {
      const telegramId = Number(req.body?.telegramId);
      const rawChannel = String(req.body?.channel ?? "");
      const channel = normalizeChannelInput(rawChannel);

      if (!telegramId || !channel) {
        return res
          .status(400)
          .json({ error: "telegramId and channel are required" });
      }

      const { rows: userRows } = await pool.query(
        "SELECT id FROM users WHERE telegram_id = $1",
        [telegramId],
      );
      if (userRows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const chat = await getChat(botToken, channel);
      if (chat.type !== "channel") {
        return res.status(400).json({ error: "Only channels are supported" });
      }

      const member = await getChatMember(botToken, String(chat.id), telegramId);
      const isAdmin =
        member.status === "administrator" || member.status === "creator";
      if (!isAdmin) {
        return res.status(403).json({ error: "User is not a channel admin" });
      }

      const botUser = await getBotUser(botToken);
      const botMember = await getChatMember(
        botToken,
        String(chat.id),
        botUser.id,
      );
      if (botMember.status !== "administrator") {
        return res.status(403).json({ error: "Bot is not a channel admin" });
      }
      if (botMember.can_post_messages === false) {
        return res
          .status(403)
          .json({ error: "Bot cannot post messages in this channel" });
      }

      await pool.query(
        `
        INSERT INTO channels (telegram_id, title, username, added_by_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id) DO UPDATE
          SET title = EXCLUDED.title,
              username = EXCLUDED.username
      `,
        [
          chat.id,
          chat.title ?? "Untitled",
          chat.username ?? null,
          userRows[0].id,
        ],
      );

      await updateChannelStats(Number(chat.id));

      const { rows } = await pool.query(
        `
        SELECT
          telegram_id,
          title,
          username,
          topic,
          price_usdt,
          subscribers,
          avg_views,
          err,
          payout_address
        FROM channels
        WHERE telegram_id = $1
      `,
        [chat.id],
      );

      return res.status(200).json({ channel: rows[0] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("member list is inaccessible")) {
        const botUsername = String(process.env.BOT_USERNAME ?? "").trim();
        const botMention = botUsername ? `@${botUsername}` : "бота";
        return res
          .status(403)
          .json({ error: `Сначала добавь ${botMention} в админы канала` });
      }
      if (message.includes("retry_after")) {
        return res.status(429).json({ error: message });
      }
      return res.status(400).json({ error: message });
    }
  }),
);

router.get(
  "/channels",
  asyncHandler(async (req, res) => {
    const topic = req.query.topic ? String(req.query.topic) : null;
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const minSubscribers = req.query.minSubscribers
      ? Number(req.query.minSubscribers)
      : null;
    const maxSubscribers = req.query.maxSubscribers
      ? Number(req.query.maxSubscribers)
      : null;
    const minViews = req.query.minViews ? Number(req.query.minViews) : null;
    const maxViews = req.query.maxViews ? Number(req.query.maxViews) : null;
    const minErr = req.query.minErr ? Number(req.query.minErr) : null;
    const maxErr = req.query.maxErr ? Number(req.query.maxErr) : null;

    if (topic && !allowedTopics.has(topic)) {
      return res.status(400).json({ error: "Invalid topic" });
    }
    if (minPrice !== null && !Number.isFinite(minPrice)) {
      return res.status(400).json({ error: "Invalid minPrice" });
    }
    if (maxPrice !== null && !Number.isFinite(maxPrice)) {
      return res.status(400).json({ error: "Invalid maxPrice" });
    }
    if (minSubscribers !== null && !Number.isFinite(minSubscribers)) {
      return res.status(400).json({ error: "Invalid minSubscribers" });
    }
    if (maxSubscribers !== null && !Number.isFinite(maxSubscribers)) {
      return res.status(400).json({ error: "Invalid maxSubscribers" });
    }
    if (minViews !== null && !Number.isFinite(minViews)) {
      return res.status(400).json({ error: "Invalid minViews" });
    }
    if (maxViews !== null && !Number.isFinite(maxViews)) {
      return res.status(400).json({ error: "Invalid maxViews" });
    }
    if (minErr !== null && !Number.isFinite(minErr)) {
      return res.status(400).json({ error: "Invalid minErr" });
    }
    if (maxErr !== null && !Number.isFinite(maxErr)) {
      return res.status(400).json({ error: "Invalid maxErr" });
    }

    const conditions: string[] = [];
    const values: Array<string | number> = [];
    const addCondition = (sql: string, value: string | number) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (topic) addCondition("topic = ?", topic);
    if (minPrice !== null) addCondition("price_usdt >= ?", minPrice);
    if (maxPrice !== null) addCondition("price_usdt <= ?", maxPrice);
    if (minSubscribers !== null)
      addCondition("subscribers >= ?", minSubscribers);
    if (maxSubscribers !== null)
      addCondition("subscribers <= ?", maxSubscribers);
    if (minViews !== null) addCondition("avg_views >= ?", minViews);
    if (maxViews !== null) addCondition("avg_views <= ?", maxViews);
    if (minErr !== null) addCondition("err >= ?", minErr);
    if (maxErr !== null) addCondition("err <= ?", maxErr);

    const baseWhere = "price_usdt IS NOT NULL AND price_usdt > 0";
    const where =
      conditions.length > 0
        ? `WHERE ${baseWhere} AND ${conditions.join(" AND ")}`
        : `WHERE ${baseWhere}`;
    const { rows } = await pool.query(
      `
      SELECT
        telegram_id,
        title,
        username,
        topic,
        price_usdt,
        subscribers,
        avg_views,
        err
      FROM channels
      ${where}
      ORDER BY created_at DESC
    `,
      values,
    );

    return res.status(200).json({ channels: rows });
  }),
);

router.get(
  "/channels/my/:telegramId",
  asyncHandler(async (req, res) => {
    const telegramId = requireIntParam(req.params.telegramId, "telegramId");
    if (req.telegramId && req.telegramId !== telegramId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { rows: userRows } = await pool.query(
      "SELECT id FROM users WHERE telegram_id = $1",
      [telegramId],
    );
    if (userRows.length == 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const baseQuery = `
      SELECT
        id,
        telegram_id,
        title,
        username,
        topic,
        price_usdt,
        subscribers,
        avg_views,
        err,
        payout_address
      FROM channels
      WHERE added_by_user_id = $1
      ORDER BY created_at DESC
    `;

    let { rows } = await pool.query(
      `
      ${baseQuery}
    `,
      [userRows[0].id],
    );

    const needsRefresh = rows.filter(
      (row) => row.subscribers === null || row.avg_views === null,
    );
    if (needsRefresh.length > 0) {
      await Promise.all(
        needsRefresh.map((row) => updateChannelStats(Number(row.telegram_id))),
      );
      const refreshed = await pool.query(baseQuery, [userRows[0].id]);
      rows = refreshed.rows;
    }

    return res.status(200).json({ channels: rows });
  }),
);

router.patch(
  "/channels/:telegramId/card",
  asyncHandler(async (req, res) => {
    const telegramId = requireIntParam(req.params.telegramId, "telegramId", {
      allowNegative: true,
    });

    const topic = req.body?.topic ? String(req.body.topic) : null;
    if (topic && !allowedTopics.has(topic)) {
      return res.status(400).json({ error: "Invalid topic" });
    }

    const priceUsdt =
      req.body?.priceUsdt !== undefined ? Number(req.body.priceUsdt) : null;
    const payoutAddress =
      req.body?.payoutAddress !== undefined
        ? String(req.body.payoutAddress)
        : null;

    if (priceUsdt !== null && (!Number.isFinite(priceUsdt) || priceUsdt < 0)) {
      return res.status(400).json({ error: "Invalid priceUsdt" });
    }
    if (payoutAddress) {
      try {
        Address.parse(payoutAddress);
      } catch {
        return res.status(400).json({ error: "Invalid payoutAddress" });
      }
    }

    // Обновляем охваты автоматически из Zyra Views
    await updateChannelStats(telegramId);

    const { rows } = await pool.query(
      `
      UPDATE channels
      SET
        topic = COALESCE($2, topic),
        price_usdt = COALESCE($3, price_usdt),
        payout_address = COALESCE($4, payout_address)
      WHERE telegram_id = $1
      RETURNING
        telegram_id,
        title,
        username,
        topic,
        price_usdt,
        subscribers,
        avg_views,
        err,
        payout_address
    `,
      [telegramId, topic, priceUsdt, payoutAddress],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Channel not found" });
    }

    return res.status(200).json({ channel: rows[0] });
  }),
);

export default router;
