import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, userAccessTable } from "@workspace/db";
import { isAdmin } from "../lib/adminAccess.js";
import { logger } from "../lib/logger.js";
import type { AuthenticatedRequest } from "./requireAuth.js";

/**
 * requireApproved — user-approval gate that runs after requireAuth.
 *
 * Every real (non-bypass) Clerk sign-in must be admin-approved before any
 * authenticated endpoint is reachable:
 *   - Admin users (isAdmin()) pass through unconditionally with no DB read.
 *   - First-time users get a `pending` row auto-upserted (ON CONFLICT DO
 *     NOTHING, so concurrent first logins never produce a duplicate-key
 *     crash) and receive 403 { error: "awaiting_approval" }.
 *   - `pending` users receive 403 { error: "awaiting_approval" }.
 *   - `banned`  users receive 403 { error: "account_banned" }.
 *   - `approved` users pass through — a single PK lookup, cached in-request
 *     via res.locals so a second invocation on the same request never
 *     re-queries.
 *
 * DB errors are forwarded to next(err) and surface as a 500 via the global
 * error handler — never a silent pass-through.
 *
 * Test-suite note: this module sits in the import graph of every route file
 * via requireAuth. The `db` / `userAccessTable` imports are referenced ONLY
 * inside the middleware body (never at module scope), so existing wholesale
 * `vi.mock("@workspace/db")` factories that don't stub userAccessTable stay
 * safe — vitest's missing-export error fires on access, not on import, and
 * legacy suites never execute this middleware (see shouldEnforceApproval).
 */

/** res.locals key caching a positive approval verdict for this request. */
const APPROVAL_LOCALS_KEY = "__userAccessApproved";

/**
 * Whether the approval gate should run for real-Clerk-authenticated
 * requests. Mirrors the catalogSeeder test-environment detection: unit
 * suites (vitest) exercise routes with mocked auth and per-file DB mocks
 * that know nothing about user_access, so enforcement is opt-in there via
 * REQUIRE_APPROVED_IN_TEST=1 (used by the dedicated middleware tests).
 * Always enforced outside test runners (dev, e2e webservers, production).
 *
 * Note the E2E bypass path (x-e2e-user-id + E2E_AUTH_BYPASS=1) never reaches
 * this check at all — requireAuth returns before the approval chain.
 */
export function shouldEnforceApproval(): boolean {
  if (process.env["REQUIRE_APPROVED_IN_TEST"] === "1") return true;
  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") return false;
  return true;
}

export async function requireApproved(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;
    if (!clerkUserId) {
      // requireApproved must always run after requireAuth; a missing user ID
      // means the chain is mis-wired. Fail closed.
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Admins are unconditionally approved — no DB read, no user_access row.
    if (isAdmin(clerkUserId)) {
      next();
      return;
    }

    // In-request cache: if a previous middleware invocation on this request
    // already verified approval, skip the DB read.
    if (res.locals[APPROVAL_LOCALS_KEY] === clerkUserId) {
      next();
      return;
    }

    // Single PK lookup.
    const [row] = await db
      .select()
      .from(userAccessTable)
      .where(eq(userAccessTable.clerkUserId, clerkUserId));

    if (!row) {
      // First login: auto-upsert a pending row. ON CONFLICT DO NOTHING makes
      // concurrent first logins race-safe (no duplicate-key 500).
      await db
        .insert(userAccessTable)
        .values({ clerkUserId, status: "pending" })
        .onConflictDoNothing();
      logger.info({ clerkUserId }, "[requireApproved] first login — pending user_access row created");
      res.status(403).json({
        error: "awaiting_approval",
        details: "Your account is awaiting admin approval.",
      });
      return;
    }

    if (row.status === "banned") {
      res.status(403).json({
        error: "account_banned",
        details: "Your account has been banned. Contact the administrator.",
      });
      return;
    }

    if (row.status !== "approved") {
      res.status(403).json({
        error: "awaiting_approval",
        details: "Your account is awaiting admin approval.",
      });
      return;
    }

    res.locals[APPROVAL_LOCALS_KEY] = clerkUserId;
    next();
  } catch (err) {
    next(err);
  }
}
