import "dotenv/config";
import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { Server } from "http";
import {
  ensureCampaignsTables,
  ensureChannelsTable,
  ensureChannelPostViewsTable,
  ensureOrdersTables,
  ensurePaymentsTable,
  ensureRolesTables,
  ensureUsersTable,
  pool,
} from "./db";
import { createAuthMiddleware } from "./authMiddleware";
import { botToken } from "./helpers";
import { logger } from "./logger";

// ─── Route modules ──────────────────────────────────────────────────
import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhook";
import channelRoutes from "./routes/channels";
import cartRoutes from "./routes/cart";
import orderRoutes from "./routes/orders";
import paymentRoutes, { processScheduledPayouts, processPendingPayments } from "./routes/payments";
import campaignRoutes, {
  processPendingCampaignPayments,
  processCampaignApplicationPayouts,
} from "./routes/campaigns";

// ─── Express app ────────────────────────────────────────────────────
const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(createAuthMiddleware(botToken));

// ─── Health check ───────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ─── Mount routers ──────────────────────────────────────────────────
app.use(authRoutes);
app.use(webhookRoutes);
app.use(channelRoutes);
app.use(cartRoutes);
app.use(orderRoutes);
app.use(paymentRoutes);
app.use(campaignRoutes);

// ─── Global error handler (must be after all routes) ────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  const statusCode =
    (err as { statusCode?: number })?.statusCode ?? 500;
  if (statusCode >= 500) {
    logger.error("Unhandled route error:", err);
  }
  if (!res.headersSent) {
    res.status(statusCode).json({ error: message });
  }
});

// ─── Overlap-safe interval runner ───────────────────────────────────
// Не запускает следующий тик, пока предыдущий не завершился.
function safeInterval(
  fn: () => Promise<void>,
  label: string,
  ms: number,
): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    fn()
      .catch((error) => logger.error(`${label} failed`, error))
      .finally(() => {
        running = false;
      });
  }, ms);
}

// ─── Database init & server start ───────────────────────────────────
let server: Server;
const intervals: NodeJS.Timeout[] = [];

ensureUsersTable()
  .then(ensureRolesTables)
  .then(ensureChannelsTable)
  .then(ensureChannelPostViewsTable)
  .then(ensureOrdersTables)
  .then(ensurePaymentsTable)
  .then(ensureCampaignsTables)
  .then(() => {
    server = app.listen(port, () => {
      logger.info(`Backend listening on http://localhost:${port}`);
    });

    intervals.push(
      safeInterval(processPendingPayments, "processPendingPayments", 30_000),
      safeInterval(processScheduledPayouts, "processScheduledPayouts", 30_000),
      safeInterval(processPendingCampaignPayments, "processPendingCampaignPayments", 30_000),
      safeInterval(processCampaignApplicationPayouts, "processCampaignApplicationPayouts", 30_000),
    );
  })
  .catch((error) => {
    logger.error("Failed to init database", error);
    process.exit(1);
  });

// ─── Graceful shutdown ──────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully…`);

  // 1. Останавливаем фоновые задачи
  for (const id of intervals) clearInterval(id);

  // 2. Прекращаем принимать новые соединения, ждём завершения текущих (5 с)
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => resolve(), 5_000);
    });
  }

  // 3. Закрываем пул БД
  try {
    await pool.end();
    } catch (err) {
    logger.error("Error closing DB pool", err);
  }

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => { gracefulShutdown("SIGTERM"); });
process.on("SIGINT", () => { gracefulShutdown("SIGINT"); });
