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

  const existing = await db
    .select()
    .from(trollingPresetFoldersTable)
    .where(eq(trollingPresetFoldersTable.userId, userId));
  if (existing.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    res
      .status(400)
      .json({ error: "duplicate_name", details: "A folder with that name already exists" });
    return;
  }

  const [created] = await db
    .insert(trollingPresetFoldersTable)
    .values({ userId, name })
    .returning();
  if (!created) {
    res.status(500).json({ error: "db_error", details: "Could not create folder" });
    return;
  }
  res.status(201).json(folderToJson(created));
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
