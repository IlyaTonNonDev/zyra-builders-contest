import { Router } from "express";
import { pool } from "../db";
import { getBotUser, getChatMember } from "../telegramBot";
import { botToken, updateChannelStats } from "../helpers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.post("/telegram/webhook", asyncHandler(async (req, res) => {
  try {
    const update = req.body ?? {};
    const channelPost = update.channel_post;
    if (channelPost?.chat?.type === "channel") {
      const channelTelegramId = Number(channelPost.chat.id);
      const viewCount = channelPost.view_count;
      if (Number.isFinite(channelTelegramId) && Number.isFinite(viewCount)) {
        await pool.query(
          "INSERT INTO channel_post_views (channel_telegram_id, view_count) VALUES ($1, $2)",
          [channelTelegramId, Number(viewCount)],
        );
      }
      return res.status(200).json({ ok: true, handled: "channel_post" });
    }
    const memberUpdate = update.my_chat_member ?? update.chat_member;
    if (!memberUpdate) {
      return res.status(200).json({ ok: true, skipped: "no_member_update" });
    }

    const chat = memberUpdate.chat;
    if (!chat || chat.type !== "channel") {
      return res.status(200).json({ ok: true, skipped: "not_channel" });
    }

    const newMember = memberUpdate.new_chat_member;
    if (!newMember) {
      return res.status(200).json({ ok: true, skipped: "no_new_member" });
    }

    const botUser = await getBotUser(botToken);
    if (!newMember.user || newMember.user.id !== botUser.id) {
      return res.status(200).json({ ok: true, skipped: "not_bot_member" });
    }

    if (newMember.status !== "administrator") {
      await pool.query(
        "UPDATE channels SET added_by_user_id = NULL WHERE telegram_id = $1",
        [Number(memberUpdate.chat.id)],
      );
      return res.status(200).json({ ok: true, skipped: "bot_removed" });
    }
    if (newMember.can_post_messages === false) {
      return res.status(200).json({ ok: true, skipped: "bot_cannot_post" });
    }

    const channelId = Number(chat.id);
    if (!Number.isFinite(channelId)) {
      return res.status(200).json({ ok: true, skipped: "invalid_channel_id" });
    }

    const fromUser = memberUpdate.from?.id ? Number(memberUpdate.from.id) : null;
    let addedByUserId: number | null = null;
    if (fromUser) {
      await pool.query(
        "INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING",
        [fromUser],
      );
      const { rows: userRows } = await pool.query(
        "SELECT id FROM users WHERE telegram_id = $1",
        [fromUser],
      );
      addedByUserId = userRows[0]?.id ?? null;
    }

    if (!addedByUserId) {
      await pool.query(
        `
          UPDATE channels
          SET title = $2, username = $3
          WHERE telegram_id = $1
        `,
        [channelId, chat.title ?? "Untitled", chat.username ?? null],
      );
      return res.status(200).json({ ok: true, skipped: "no_admin_user" });
    }

    await pool.query(
      `
        INSERT INTO channels (telegram_id, title, username, added_by_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id) DO UPDATE
          SET title = EXCLUDED.title,
              username = EXCLUDED.username,
              added_by_user_id = COALESCE(channels.added_by_user_id, EXCLUDED.added_by_user_id)
      `,
      [channelId, chat.title ?? "Untitled", chat.username ?? null, addedByUserId],
    );

    await updateChannelStats(channelId);

    return res.status(200).json({ ok: true, telegramId: channelId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook error";
    return res.status(400).json({ error: message });
  }
}));

export default router;
