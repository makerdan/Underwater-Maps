import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, markersTable } from "@workspace/db";
import { PostMarkersBody, DeleteMarkersIdParams, GetMarkersQueryParams, PatchMarkersIdParams, PatchMarkersIdBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";


const router = Router();

router.get("/markers", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = GetMarkersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "datasetId query parameter is required" });
    return;
  }

  const { datasetId } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const rows = await db
    .select()
    .from(markersTable)
    .where(and(eq(markersTable.datasetId, datasetId), eq(markersTable.userId, userId)))
    .orderBy(markersTable.createdAt);

  res.json(rows);
}));

router.post("/markers", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = PostMarkersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.message });
    return;
  }

  const { datasetId, lon, lat, depth, type = "custom", label, notes } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const [created] = await db
    .insert(markersTable)
    .values({ datasetId, lon, lat, depth, type, label, notes: notes ?? null, userId })
    .returning();

  res.status(201).json(created);
}));

router.delete("/markers/mine", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const deleted = await db
    .delete(markersTable)
    .where(eq(markersTable.userId, userId))
    .returning({ id: markersTable.id });

  res.json({ deleted: deleted.length });
}));

router.patch("/markers/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const params = PatchMarkersIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }
  const body = PatchMarkersIdBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_request", details: body.error.message });
    return;
  }

  const { id } = params.data;
  const updateData = body.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "invalid_request", details: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(markersTable)
    .set(updateData)
    .where(and(eq(markersTable.id, id), eq(markersTable.userId, userId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", details: `Marker '${id}' not found` });
    return;
  }

  res.json(updated);
}));

router.delete("/markers/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = DeleteMarkersIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }

  const { id } = parsed.data;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const deleted = await db
    .delete(markersTable)
    .where(and(eq(markersTable.id, id), eq(markersTable.userId, userId)))
    .returning({ id: markersTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Marker '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

export default router;
