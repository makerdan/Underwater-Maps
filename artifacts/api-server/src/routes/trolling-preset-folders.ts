/**
 * /trolling-preset-folders — folder CRUD for grouping saved trolling presets.
 *
 * Folders are flat (no nesting) and per-user. Sibling names are unique
 * case-insensitively. Deleting a folder leaves the presets inside intact —
 * the schema's onDelete:set null moves them to the implicit root group.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, trollingPresetFoldersTable } from "@workspace/db";
import {
  PostTrollingPresetFoldersBody,
  PatchTrollingPresetFoldersIdBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `err` is a PostgreSQL unique-constraint violation
 * (SQLSTATE 23505). Used to translate DB-level duplicate-name errors into 409
 * so concurrent requests that both pass the in-process fast-path check get a
 * consistent response code.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

const router = Router();

function folderToJson(row: typeof trollingPresetFoldersTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function trimName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || t.length > 80) return null;
  return t;
}

router.get("/trolling-preset-folders", requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await db
    .select()
    .from(trollingPresetFoldersTable)
    .where(eq(trollingPresetFoldersTable.userId, userId));
  // TODO: no response schema in @workspace/api-zod for this route; add validateResponse when a schema is available
  res.json(rows.map(folderToJson));
}));

router.post("/trolling-preset-folders", requireAuth, dataMutationRateLimit, validateBody(PostTrollingPresetFoldersBody, "POST /api/trolling-preset-folders"), asyncHandler(async (req, res) => {
  const { name: rawName } = res.locals.parsedBody;
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Folder name is required" });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;

  // Fast-path duplicate check — catches single-request duplicates cheaply.
  // This is a read-then-write and is NOT race-safe for concurrent requests;
  // the DB unique index on (userId, lower(name)) is the authoritative guard.
  const existing = await db
    .select()
    .from(trollingPresetFoldersTable)
    .where(eq(trollingPresetFoldersTable.userId, userId));
  if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    res
      .status(409)
      .json({ error: "duplicate_name", details: "A folder with that name already exists" });
    return;
  }

  // The DB unique index on (userId, lower(name)) is the final arbiter for
  // concurrent requests that both pass the fast-path check above.  Catch the
  // unique violation and translate it to 409 so the client gets a consistent
  // error code regardless of whether the duplicate was detected in-process or
  // at the DB level.
  try {
    const [created] = await db
      .insert(trollingPresetFoldersTable)
      .values({ userId, name })
      .returning();
    if (!created) {
      res.status(500).json({ error: "db_error", details: "Could not create folder" });
      return;
    }
    res.status(201).json(folderToJson(created));
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "duplicate_name", details: "A folder with that name already exists" });
      return;
    }
    throw err;
  }
}));

router.patch("/trolling-preset-folders/:id", requireAuth, dataMutationRateLimit, validateBody(PatchTrollingPresetFoldersIdBody, "PATCH /api/trolling-preset-folders/:id"), asyncHandler(async (req, res) => {
  const { name: rawName } = res.locals.parsedBody;
  const name = trimName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid_name", details: "Folder name is required" });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const rows = await db
    .select()
    .from(trollingPresetFoldersTable)
    .where(eq(trollingPresetFoldersTable.userId, userId));
  const target = rows.find((r) => r.id === id);
  if (!target) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  if (rows.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
    res
      .status(400)
      .json({ error: "duplicate_name", details: "A folder with that name already exists" });
    return;
  }

  const [updated] = await db
    .update(trollingPresetFoldersTable)
    .set({ name, updatedAt: new Date() })
    .where(
      and(
        eq(trollingPresetFoldersTable.id, id),
        eq(trollingPresetFoldersTable.userId, userId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  res.json(folderToJson(updated));
}));

router.delete("/trolling-preset-folders/:id", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res) => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  // FK onDelete:set null in the trolling_presets table moves any presets in
  // the deleted folder back to the implicit root group automatically.
  const deleted = await db
    .delete(trollingPresetFoldersTable)
    .where(
      and(
        eq(trollingPresetFoldersTable.id, id),
        eq(trollingPresetFoldersTable.userId, userId),
      ),
    )
    .returning({ id: trollingPresetFoldersTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: "Folder not found" });
    return;
  }
  res.status(204).send();
}));

export default router;
