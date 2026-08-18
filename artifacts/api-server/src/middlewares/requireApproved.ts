import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, userAccessTable } from "@workspace/db";
import { isAdmin } from "../lib/adminAccess.js";
import { logger } from "../lib/logger.js";
import { notifyAdminsNewPendingUser } from "../lib/adminEmail.js";
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
 * Best-effort: fetch the Clerk profile for a newly-created pending user and
 * store email + displayName in their user_access row so the admin approval
 * list shows human-readable identifiers rather than bare Clerk user IDs.
 *
 * Returns the fetched profile fields so callers can use them without an extra
 * DB round-trip. Returns null when the Clerk fetch fails or yields nothing useful.
 *
 * All failures are caught and logged — the caller must NOT rely on this
 * succeeding; the pending row is already committed before this runs.
 */
export async function fetchAndStoreClerkProfile(
  clerkUserId: string,
): Promise<{ email: string | null; displayName: string | null } | null> {
  try {
    // @clerk/express exports clerkClient as a ready-made client object
    // (not a factory) — calling it fails typecheck and would throw at runtime.
    const clerk = clerkClient;
    const user = await clerk.users.getUser(clerkUserId);

    const email = user.emailAddresses[0]?.emailAddress ?? null;
    const firstName = user.firstName ?? "";
    const lastName = user.lastName ?? "";
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || user.username || null;

    if (!email && !displayName) return null; // nothing useful to store

    await db
      .update(userAccessTable)
      .set({ email, displayName })
      .where(eq(userAccessTable.clerkUserId, clerkUserId));

    logger.info(
      { clerkUserId, email, displayName },
      "[requireApproved] enriched pending user_access row from Clerk profile",
    );
    return { email, displayName };
  } catch (err) {
    logger.warn(
      { clerkUserId, err },
      "[requireApproved] failed to fetch Clerk profile for new pending user — fields will remain null",
    );
    return null;
  }
}

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

      // Best-effort: populate email + displayName so the admin approval list
      // shows human-readable identifiers. Returns the fetched profile fields
      // (or null on failure) so we can pass them to the email notification
      // without a second DB round-trip.
      const profile = await fetchAndStoreClerkProfile(clerkUserId);

      // Best-effort: notify admins by email that a new user is waiting.
      // All failures are swallowed inside the helper — the 403 is never delayed.
      void notifyAdminsNewPendingUser({
        clerkUserId,
        displayName: profile?.displayName ?? null,
        email: profile?.email ?? null,
      });

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
