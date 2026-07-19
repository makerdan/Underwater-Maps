import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.js";

/**
 * Strip user-controlled `.received` values from a Zod issue object before
 * logging or returning it in a response. Keeps `.path`, `.code`, and
 * `.message` which are sufficient for debugging without echoing user input.
 *
 * Exported so that routes with bespoke validation logic (e.g. settings.ts)
 * can reuse the same sanitization pattern rather than reimplementing it.
 */
export function sanitizeZodIssue(issue: Record<string, unknown>): Record<string, unknown> {
  const { received: _r, ...safe } = issue;
  return safe;
}

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 *
 * On failure: emits a `logger.warn` with sanitized issue paths/codes (no raw
 * user input echoed), then returns a structured `400` response with sanitized
 * details. Future routes automatically get consistent server-side logging by
 * using this factory instead of rolling their own inline safeParse checks.
 *
 * On success: attaches the parsed (coerced) value to `res.locals.parsedBody`
 * and calls `next()`. Handlers should read `res.locals.parsedBody` rather than
 * re-calling `safeParse`.
 *
 * @param schema     - Zod schema to validate `req.body` against.
 * @param routeLabel - Human-readable label used in log messages,
 *                     e.g. "POST /api/markers".
 */
export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  routeLabel: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const logIssues = parsed.error.issues.map((i) => ({ path: i.path, code: i.code }));
      const safeIssues = parsed.error.issues.map((i) =>
        sanitizeZodIssue(i as unknown as Record<string, unknown>),
      );
      const sanitizedDetails = parsed.error.issues
        .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.code}`)
        .join("; ");
      logger.warn(
        { route: routeLabel, issues: logIssues },
        `${routeLabel} — Zod body validation failed`,
      );
      res.status(400).json({ error: "invalid_request", details: sanitizedDetails, issues: safeIssues });
      return;
    }
    res.locals.parsedBody = parsed.data as z.infer<T>;
    next();
  };
}
