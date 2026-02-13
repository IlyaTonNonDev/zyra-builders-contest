import type { Request, Response, NextFunction } from "express";

/**
 * Wraps an async Express route handler so that any unhandled rejection
 * is forwarded to Express error middleware via next(error).
 *
 * Without this wrapper, a thrown error inside an async handler would
 * become an unhandled promise rejection and Express would not send
 * any response, eventually timing out.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
