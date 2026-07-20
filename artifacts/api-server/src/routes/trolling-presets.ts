import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, trollingPresetsTable, trollingPresetFoldersTable } from "@workspace/db";
import {
  PostTrollingPresetsBody,
  PatchTrollingPresetsIdBody,
  DeleteTrollingPresetsIdParams,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";

const router = Router();

router.get("/trolling-presets", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await db
    .select()
    .from(trollingPresetsTable)
    .where(eq(trollingPresetsTable.userId, userId))
    .orderBy(asc(trollingPresetsTable.sortOrder), asc(trollingPresetsTable.createdAt));
  res.json(rows);
}));

router.post("/trolling-presets", requireAuth, dataMutationRateLimit, validateBody(PostTrollingPresetsBody, "POST /api/trolling-presets"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { name, headingDeg, speedKnots, startLat, startLon, waypoints, folderId } = res.locals.parsedBody;

  if (folderId) {
    const [folder] = await db
      .select({ id: trollingPresetFoldersTable.id })
      .from(trollingPresetFoldersTable)
      .where(
        and(
          eq(trollingPresetFoldersTable.id, folderId),
          eq(trollingPresetFoldersTable.userId, userId),
        ),
      );
    if (!folder) {
      res.status(400).json({ error: "invalid_folder", details: "Folder not found" });
      return;
    }
  }

  const [created] = await db
    .insert(trollingPresetsTable)
    .values({
      userId,
      name,
      headingDeg,
      speedKnots,
      startLat: startLat ?? null,
      startLon: startLon ?? null,
      waypoints: waypoints ?? [],
      folderId: folderId ?? null,
    })
    .returning();

  res.status(201).json(created);
}));

router.patch("/trolling-presets/:id", requireAuth, dataMutationRateLimit, validateBody(PatchTrollingPresetsIdBody, "PATCH /api/trolling-presets/:id"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const { name: pName, sortOrder: pSortOrder, folderId: pFolderId } = res.locals.parsedBody;
  const updates: { name?: string; sortOrder?: number; folderId?: string | null } = {};
  if (pName !== undefined) updates.name = pName;
  if (pSortOrder !== undefined) updates.sortOrder = pSortOrder;
  if (pFolderId !== undefined) updates.folderId = pFolderId;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "invalid_request", details: "No fields to update" });
    return;
  }

  if (updates.folderId) {
    const [folder] = await db
      .select({ id: trollingPresetFoldersTable.id })
      .from(trollingPresetFoldersTable)
      .where(
        and(
          eq(trollingPresetFoldersTable.id, updates.folderId),
          eq(trollingPresetFoldersTable.userId, userId),
        ),
      );
    if (!folder) {
      res.status(400).json({ error: "invalid_folder", details: "Folder not found" });
      return;
    }
  }

  const [updated] = await db
    .update(trollingPresetsTable)
    .set(updates)
    .where(and(eq(trollingPresetsTable.id, id), eq(trollingPresetsTable.userId, userId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", details: `Preset '${id}' not found` });
    return;
  }

  res.json(updated);
}));

router.delete("/trolling-presets/:id", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const parsed = DeleteTrollingPresetsIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid preset id" });
    return;
  }
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { id } = parsed.data;

  const deleted = await db
    .delete(trollingPresetsTable)
    .where(and(eq(trollingPresetsTable.id, id), eq(trollingPresetsTable.userId, userId)))
    .returning({ id: trollingPresetsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Preset '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

export default router;
