import { Request, Response, NextFunction } from "express";
import { validateInitData } from "./telegram";

/* Расширяем Express Request: после прохождения middleware
   req.telegramId содержит ID аутентифицированного пользователя. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      telegramId?: number;
    }
  }
}

/**
 * Маршруты, доступные без авторизации.
 * Для всех остальных маршрутов требуется заголовок:
 *   Authorization: tma <initData>
 */
const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/health$/ },
  { method: "POST", pattern: /^\/telegram\/webhook$/ },
  { method: "POST", pattern: /^\/auth\/telegram$/ },
  { method: "GET", pattern: /^\/channels$/ },
  { method: "GET", pattern: /^\/campaigns$/ },
  { method: "GET", pattern: /^\/campaigns\/\d+$/ },
  { method: "GET", pattern: /^\/campaigns\/\d+\/applications$/ },
  { method: "GET", pattern: /^\/campaigns\/by-reference\/.+$/ },
  { method: "POST", pattern: /^\/payments\/\d+\/refresh$/ },
];

export function createAuthMiddleware(botToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isPublic = PUBLIC_ROUTES.some(
      (route) => route.method === req.method && route.pattern.test(req.path),
    );
    if (isPublic) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }

    const match = authHeader.match(/^tma\s+(.+)$/i);
    if (!match) {
      res.status(401).json({ error: "Invalid authorization format" });
      return;
    }

    try {
      const { user } = validateInitData(match[1], botToken);
      req.telegramId = user.id;
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed";
      res.status(401).json({ error: message });
    }
  };
}
