/**
 * Lightweight logger with:
 * - Message truncation (prevents huge stack traces from eating disk)
 * - Rate-limiting / deduplication (same message won't flood logs)
 *
 * No external dependencies. Writes to stdout/stderr.
 */

const MAX_MESSAGE_LENGTH = 500;
const DEDUP_WINDOW_MS = 60_000; // 1 minute
const MAX_DEDUP_ENTRIES = 200;

const recentMessages = new Map<string, { count: number; firstAt: number; lastAt: number }>();

function cleanupDedup() {
  if (recentMessages.size <= MAX_DEDUP_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of recentMessages) {
    if (now - entry.lastAt > DEDUP_WINDOW_MS) {
      recentMessages.delete(key);
    }
  }
}

function truncate(value: unknown): string {
  const str =
    value instanceof Error
      ? `${value.message}${value.stack ? "\n" + value.stack : ""}`
      : String(value);
  if (str.length <= MAX_MESSAGE_LENGTH) return str;
  return str.slice(0, MAX_MESSAGE_LENGTH) + `… [truncated, total ${str.length} chars]`;
}

function formatArgs(args: unknown[]): string {
  return args.map(truncate).join(" ");
}

function shouldLog(message: string): boolean {
  const now = Date.now();
  const key = message.slice(0, 120); // dedup key from first 120 chars

  const entry = recentMessages.get(key);
  if (!entry) {
    recentMessages.set(key, { count: 1, firstAt: now, lastAt: now });
    cleanupDedup();
    return true;
  }

  if (now - entry.lastAt > DEDUP_WINDOW_MS) {
    // Window expired — log and reset
    if (entry.count > 1) {
      // eslint-disable-next-line no-console
      console.error(
        `[logger] previous message repeated ${entry.count} times in ${Math.round((entry.lastAt - entry.firstAt) / 1000)}s`,
      );
    }
    recentMessages.set(key, { count: 1, firstAt: now, lastAt: now });
    return true;
  }

  // Within window — suppress but count
  entry.count++;
  entry.lastAt = now;
  return false;
}

export const logger = {
  info(...args: unknown[]) {
    const msg = formatArgs(args);
    if (shouldLog(msg)) {
      // eslint-disable-next-line no-console
      console.log(`[${new Date().toISOString()}] INFO  ${msg}`);
    }
  },

  warn(...args: unknown[]) {
    const msg = formatArgs(args);
    if (shouldLog(msg)) {
      // eslint-disable-next-line no-console
      console.warn(`[${new Date().toISOString()}] WARN  ${msg}`);
    }
  },

  error(...args: unknown[]) {
    const msg = formatArgs(args);
    if (shouldLog(msg)) {
      // eslint-disable-next-line no-console
      console.error(`[${new Date().toISOString()}] ERROR ${msg}`);
    }
  },
};
