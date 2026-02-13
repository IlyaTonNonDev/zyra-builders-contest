import { Router } from "express";
import { pool } from "../db";
import { validateInitData } from "../telegram";
import { botToken, requireIntParam } from "../helpers";
import { asyncHandler } from "../asyncHandler";

const router = Router();

router.post("/auth/telegram", asyncHandler(async (req, res) => {
  try {
    const initData = String(req.body?.initData ?? "");
    if (!initData) {
      return res.status(400).json({ error: "initData is required" });
    }

    const { user } = validateInitData(initData, botToken);
    await pool.query(
      "INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING",
      [user.id],
    );

    const { rows } = await pool.query(
      "SELECT telegram_id, created_at FROM users WHERE telegram_id = $1",
      [user.id],
    );

    return res.status(200).json({ telegramId: user.id, user: rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(401).json({ error: message });
  }
}));

router.get("/users/:telegramId/roles", asyncHandler(async (req, res) => {
  const telegramId = requireIntParam(req.params.telegramId, "telegramId");

  const { rows: userRows } = await pool.query(
    "SELECT id FROM users WHERE telegram_id = $1",
    [telegramId],
  );
  if (userRows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const { rows } = await pool.query(
    `
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name
    `,
    [userRows[0].id],
  );

  return res.status(200).json({ telegramId, roles: rows.map((row) => row.name) });
}));

router.post("/users/roles", asyncHandler(async (req, res) => {
  const telegramId = Number(req.body?.telegramId);
  const role = String(req.body?.role ?? "");

  if (!telegramId || !role) {
    return res.status(400).json({ error: "telegramId and role are required" });
  }

  const allowedRoles = new Set(["channel_admin", "advertiser"]);
  if (!allowedRoles.has(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const { rows: userRows } = await pool.query(
    "SELECT id FROM users WHERE telegram_id = $1",
    [telegramId],
  );
  if (userRows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const { rows: roleRows } = await pool.query(
    "SELECT id FROM roles WHERE name = $1",
    [role],
  );

  await pool.query(
    `
      INSERT INTO user_roles (user_id, role_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [userRows[0].id, roleRows[0].id],
  );

  return res.status(200).json({ telegramId, role });
}));

export default router;
