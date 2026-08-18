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
import { and, asc, eq, gt } from "drizzle-orm";
import { db, userAccessTable, type UserAccessRow } from "@workspace/db";
import {
  AdminListUsersResponse,
  AdminApproveUserResponse,
  AdminBanUserResponse,
  AdminRestoreUserResponse,
  AdminDeleteUserResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { isAdmin } from "../lib/adminAccess.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";

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

    res.json(
      validateResponse(
        AdminListUsersResponse,
        { users: page.map(toUserRecord), nextCursor },
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
