import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  clerkUserId: string;
}

/**
 * Dev-only e2e auth bypass.
 *
 * When the `E2E_AUTH_BYPASS=1` env var is set (only ever true in dev/test
 * webServer runs), incoming requests carrying an `x-e2e-user-id` header are
 * authenticated as that user without contacting Clerk. This lets Playwright
 * end-to-end tests exercise auth-gated routes (marker create/delete, trails,
 * etc.) against the real database and real mutation pipeline without needing
 * a Clerk test tenant.
 *
 * Hard-gated on the env var so production deployments cannot accidentally
 * accept this header.
 */
function readBypassUserId(req: Request): string | null {
  if (process.env["E2E_AUTH_BYPASS"] !== "1") return null;
  const raw = req.headers["x-e2e-user-id"];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const bypassUserId = readBypassUserId(req);
  if (bypassUserId) {
    (req as AuthenticatedRequest).clerkUserId = bypassUserId;
    next();
    return;
  }

  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).clerkUserId = userId;
  next();
}
