import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { requireApproved, shouldEnforceApproval } from "./requireApproved.js";

// ---------------------------------------------------------------------------
// Production safety guard — refuse to start if E2E_AUTH_BYPASS is active
// in a production Replit deployment. This is checked once at module load so
// the server aborts immediately rather than accepting (and bypassing) real
// user requests.
// ---------------------------------------------------------------------------
if (
  process.env["E2E_AUTH_BYPASS"] === "1" &&
  (process.env["NODE_ENV"] === "production" || Boolean(process.env["REPLIT_DEPLOYMENT"]))
) {
  throw new Error(
    "[requireAuth] E2E_AUTH_BYPASS=1 is set but NODE_ENV=production or REPLIT_DEPLOYMENT is " +
      "present. This combination is forbidden — it would allow any caller to impersonate any " +
      "user. Server startup aborted.",
  );
}

// Emit a single startup warning when the bypass is active so it is visible
// in server logs even if no bypass request is ever received.
if (process.env["E2E_AUTH_BYPASS"] === "1") {
  logger.warn(
    "[requireAuth] E2E_AUTH_BYPASS=1 is active — authentication is bypassed for requests " +
      "carrying the e2e bypass headers. This must never be set in production.",
  );
}

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
 *
 * Secondary guard: when `E2E_BYPASS_SECRET` is configured, the request must
 * also carry an `x-e2e-bypass-secret` header whose value matches that env
 * var. This prevents a header-only attack in the unlikely event that
 * `E2E_AUTH_BYPASS=1` accidentally leaks into a non-dev deployment.
 */
function readBypassUserId(req: Request): string | null {
  if (process.env["E2E_AUTH_BYPASS"] !== "1") return null;

  // Secondary guard: require the bypass secret header to match the server-side
  // secret when one is configured.
  const serverSecret = process.env["E2E_BYPASS_SECRET"];
  if (serverSecret) {
    const clientSecret = req.headers["x-e2e-bypass-secret"];
    if (typeof clientSecret !== "string" || clientSecret !== serverSecret) {
      return null;
    }
  }

  const raw = req.headers["x-e2e-user-id"];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const bypassUserId = readBypassUserId(req);
  if (bypassUserId) {
    // E2E bypass path: the approval gate is intentionally skipped — e2e and
    // integration suites exercise routes as arbitrary user IDs with no
    // user_access rows. requireApproved must never run on this path.
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

  // Approval gate: every real Clerk sign-in must be admin-approved (or an
  // admin) before reaching any authenticated endpoint. Chained here so that
  // every route using requireAuth gets the check without per-route wiring.
  // requireApproved handles its own errors (forwards to next(err)).
  if (shouldEnforceApproval()) {
    void requireApproved(req, res, next);
    return;
  }
  next();
}
