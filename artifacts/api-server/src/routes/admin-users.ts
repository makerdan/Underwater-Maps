/**
 * /admin/users — admin-only user approval management.
 *
 * Backs the user-approval system: every Clerk sign-in lands in user_access
 * as `pending` (auto-upserted by requireApproved) and an admin manages the
 * lifecycle through these endpoints:
 *
 *   GET    /admin/users                          — paginated list (?status, ?limit, ?cursor)
 *   POST   /admin/users/:clerkUserId/approve     — set status to approved
 *   POST   /admin/users/:clerkUserId/ban         — set status to banned (+ optional note)
 *   POST   /admin/users/:clerkUserId/restore     — set a banned user back to approved
 *   DELETE /admin/users/:clerkUserId             — hard-delete the row (user returns
 *                                                  to pending on next login)
 *
 * Access: auth-required; restricted to admin users (same rules as
 * /admin/bucket-monitor — ADMIN_USER_IDS env var or BUCKET_MONITOR_ADMIN=1).
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, count, eq, gt } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, userAccessTable, type UserAccessRow } from "@workspace/db";
import {
  AdminListUsersResponse,
  AdminApproveUserResponse,
  AdminBanUserResponse,
  AdminRestoreUserResponse,
  AdminDeleteUserResponse,
  AdminPendingCountResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { isAdmin } from "../lib/adminAccess.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ---------------------------------------------------------------------------
// Request schemas (local — request validation only; response shapes come from
// the generated OpenAPI zod schemas above).
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const AdminUsersListQuerySchema = z
  .object({
    status: z.enum(["pending", "approved", "banned"]).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const AdminUsersParamsSchema = z.object({
  clerkUserId: z.string().trim().min(1).max(256),
});

// .default({}) so a bodyless POST (req.body === undefined) is accepted — the
// note is optional and most bans won't carry one.
const AdminBanUserBodySchema = z
  .object({
    note: z.string().max(2000).optional(),
  })
  .strict()
  .default({});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lazily enrich rows that have no email or displayName by fetching their
 * Clerk profiles and persisting the data back to user_access. Individual
 * failures are caught so one bad Clerk lookup never breaks the whole list.
 * Returns a map of clerkUserId → updated row for the caller to merge in.
 */
async function enrichMissingProfiles(
  rows: UserAccessRow[],
): Promise<Map<string, UserAccessRow>> {
  const results = new Map<string, UserAccessRow>();
  const needsEnrichment = rows.filter((r) => !r.email || !r.displayName);
  if (needsEnrichment.length === 0) return results;

  // @clerk/express exports clerkClient as a ready-made client object
  // (not a factory) — calling it fails typecheck and would throw at runtime.
  const clerk = clerkClient;

  await Promise.allSettled(
    needsEnrichment.map(async (row) => {
      try {
        const user = await clerk.users.getUser(row.clerkUserId);

        const email = user.emailAddresses[0]?.emailAddress ?? null;
        const firstName = user.firstName ?? "";
        const lastName = user.lastName ?? "";
        const displayName =
          [firstName, lastName].filter(Boolean).join(" ") || user.username || null;

        const [updated] = await db
          .update(userAccessTable)
          .set({ email, displayName })
          .where(eq(userAccessTable.clerkUserId, row.clerkUserId))
          .returning();

        if (updated) results.set(row.clerkUserId, updated);
      } catch (err) {
        logger.warn(
          { clerkUserId: row.clerkUserId, err },
          "[admin-users] failed to enrich row from Clerk profile — row returned as-is",
        );
      }
    }),
  );

  return results;
}

/** 403 + null when the caller is not an admin; the caller's ID otherwise. */
function requireAdminCaller(req: Request, res: Response): string | null {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  if (!isAdmin(userId)) {
    res.status(403).json({ error: "forbidden", details: "Admin access required" });
    return null;
  }
  return userId;
}

/** Serialise a user_access row for JSON responses (Dates → ISO strings). */
function toUserRecord(row: UserAccessRow) {
  return {
    clerkUserId: row.clerkUserId,
    status: row.status,
    email: row.email,
    displayName: row.displayName,
    adminNote: row.adminNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /admin/users/pending-count — lightweight count of pending users
// ---------------------------------------------------------------------------

router.get(
  "/admin/users/pending-count",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;

    const [result] = await db
      .select({ count: count() })
      .from(userAccessTable)
      .where(eq(userAccessTable.status, "pending"));

    res.json(
      validateResponse(
        AdminPendingCountResponse,
        { count: result?.count ?? 0 },
        "GET /api/admin/users/pending-count",
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// GET /admin/users — paginated list
// ---------------------------------------------------------------------------

router.get(
  "/admin/users",
  requireAuth,
  validateQuery(AdminUsersListQuerySchema, "GET /api/admin/users", { errorCode: "invalid_param" }),
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;

    const { status, limit, cursor } = res.locals.parsedQuery as z.infer<
      typeof AdminUsersListQuerySchema
    >;
    const pageSize = limit ?? DEFAULT_LIMIT;

    const conditions = [];
    if (status) conditions.push(eq(userAccessTable.status, status));
    if (cursor) conditions.push(gt(userAccessTable.clerkUserId, cursor));

    // Keyset pagination on the PK: fetch one extra row to know whether a
    // next page exists without a separate COUNT.
    const rows = await db
      .select()
      .from(userAccessTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(userAccessTable.clerkUserId))
      .limit(pageSize + 1);

    const page = rows.slice(0, pageSize);
    const nextCursor = rows.length > pageSize ? page[page.length - 1]!.clerkUserId : null;

    // Lazily backfill email/displayName for rows missing Clerk profile data so
    // the admin sees human-readable identifiers immediately. Failures per row
    // are swallowed inside enrichMissingProfiles — the list always renders.
    const enriched = await enrichMissingProfiles(page);
    const enrichedPage = page.map((r) => enriched.get(r.clerkUserId) ?? r);

    res.json(
      validateResponse(
        AdminListUsersResponse,
        { users: enrichedPage.map(toUserRecord), nextCursor },
        "GET /api/admin/users",
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/users/:clerkUserId/approve
// ---------------------------------------------------------------------------

router.post(
  "/admin/users/:clerkUserId/approve",
  requireAuth,
  validateParams(AdminUsersParamsSchema, "POST /api/admin/users/:clerkUserId/approve"),
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;
    const { clerkUserId } = res.locals.parsedParams as z.infer<typeof AdminUsersParamsSchema>;

    const [updated] = await db
      .update(userAccessTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(userAccessTable.clerkUserId, clerkUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found", details: "No user_access row for that Clerk user ID" });
      return;
    }

    res.json(
      validateResponse(
        AdminApproveUserResponse,
        { user: toUserRecord(updated) },
        "POST /api/admin/users/:clerkUserId/approve",
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/users/:clerkUserId/ban — optional { note } body
// ---------------------------------------------------------------------------

router.post(
  "/admin/users/:clerkUserId/ban",
  requireAuth,
  validateParams(AdminUsersParamsSchema, "POST /api/admin/users/:clerkUserId/ban"),
  validateBody(AdminBanUserBodySchema, "POST /api/admin/users/:clerkUserId/ban"),
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;
    const { clerkUserId } = res.locals.parsedParams as z.infer<typeof AdminUsersParamsSchema>;
    const { note } = res.locals.parsedBody as z.infer<typeof AdminBanUserBodySchema>;

    const [updated] = await db
      .update(userAccessTable)
      .set({
        status: "banned",
        updatedAt: new Date(),
        ...(note !== undefined ? { adminNote: note } : {}),
      })
      .where(eq(userAccessTable.clerkUserId, clerkUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found", details: "No user_access row for that Clerk user ID" });
      return;
    }

    res.json(
      validateResponse(
        AdminBanUserResponse,
        { user: toUserRecord(updated) },
        "POST /api/admin/users/:clerkUserId/ban",
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// POST /admin/users/:clerkUserId/restore — banned → approved
// ---------------------------------------------------------------------------

router.post(
  "/admin/users/:clerkUserId/restore",
  requireAuth,
  validateParams(AdminUsersParamsSchema, "POST /api/admin/users/:clerkUserId/restore"),
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;
    const { clerkUserId } = res.locals.parsedParams as z.infer<typeof AdminUsersParamsSchema>;

    const [updated] = await db
      .update(userAccessTable)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(userAccessTable.clerkUserId, clerkUserId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "not_found", details: "No user_access row for that Clerk user ID" });
      return;
    }

    res.json(
      validateResponse(
        AdminRestoreUserResponse,
        { user: toUserRecord(updated) },
        "POST /api/admin/users/:clerkUserId/restore",
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// DELETE /admin/users/:clerkUserId — hard delete (returns to pending on next login)
// ---------------------------------------------------------------------------

router.delete(
  "/admin/users/:clerkUserId",
  requireAuth,
  validateParams(AdminUsersParamsSchema, "DELETE /api/admin/users/:clerkUserId"),
  asyncHandler(async (req, res) => {
    if (!requireAdminCaller(req, res)) return;
    const { clerkUserId } = res.locals.parsedParams as z.infer<typeof AdminUsersParamsSchema>;

    const [deleted] = await db
      .delete(userAccessTable)
      .where(eq(userAccessTable.clerkUserId, clerkUserId))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "not_found", details: "No user_access row for that Clerk user ID" });
      return;
    }

    res.json(
      validateResponse(
        AdminDeleteUserResponse,
        { deleted: true, clerkUserId: deleted.clerkUserId },
        "DELETE /api/admin/users/:clerkUserId",
      ),
    );
  }),
);

export default router;
