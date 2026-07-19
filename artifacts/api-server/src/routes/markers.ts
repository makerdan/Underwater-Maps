import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, markersTable, catchCountersTable, catchEntriesTable } from "@workspace/db";
import { PostMarkersBody, DeleteMarkersIdParams, GetMarkersQueryParams, PatchMarkersIdParams, PatchMarkersIdBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";


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

router.post("/markers", requireAuth, validateBody(PostMarkersBody, "POST /api/markers"), asyncHandler(async (req, res): Promise<void> => {
  const { datasetId, lon, lat, depth, type = "custom", label, notes, quickCatch, conditions } = res.locals.parsedBody;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  let finalLabel = label;
  let catchSeq: number | null = null;

  if (quickCatch) {
    // Atomically allocate the user's next catch number. The counter is
    // monotonically increasing and never decremented on delete, so numbers
    // are never reused.
    const [counter] = await db
      .insert(catchCountersTable)
      .values({ userId, lastSeq: 1 })
      .onConflictDoUpdate({
        target: catchCountersTable.userId,
        set: { lastSeq: sql`${catchCountersTable.lastSeq} + 1` },
      })
      .returning({ lastSeq: catchCountersTable.lastSeq });
    catchSeq = counter!.lastSeq;
    finalLabel = `Catch ${catchSeq}`;
  }

  // Serialize conditions for jsonb storage (capturedAt arrives as a Date
  // from zod.coerce.date()).
  const conditionsJson = conditions
    ? (JSON.parse(JSON.stringify(conditions)) as Record<string, unknown>)
    : null;

  const [created] = await db
    .insert(markersTable)
    .values({
      datasetId,
      lon,
      lat,
      depth,
      type,
      label: finalLabel,
      notes: notes ?? null,
      userId,
      catchSeq,
      conditions: conditionsJson,
    })
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

router.patch("/markers/:id", requireAuth, validateBody(PatchMarkersIdBody, "PATCH /api/markers/:id"), asyncHandler(async (req, res): Promise<void> => {
  const params = PatchMarkersIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid marker id" });
    return;
  }

  const { id } = params.data;
  const updateData = res.locals.parsedBody;
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

  // Collect all photo object paths from catch entries before the cascade delete
  // removes them. This lets us fire best-effort GCS cleanup immediately rather
  // than waiting up to 24 h for the orphaned-photos sweep.
  const entries = await db
    .select({ photos: catchEntriesTable.photos })
    .from(catchEntriesTable)
    .where(eq(catchEntriesTable.markerId, id));

  const photoPaths = entries.flatMap((e) => e.photos ?? []);

  const deleted = await db
    .delete(markersTable)
    .where(and(eq(markersTable.id, id), eq(markersTable.userId, userId)))
    .returning({ id: markersTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Marker '${id}' not found` });
    return;
  }

  // Best-effort: delete associated photo objects now that the DB rows are gone.
  if (photoPaths.length > 0) {
    const service = new ObjectStorageService();
    void Promise.allSettled(
      photoPaths.map((p) =>
        service.deleteObjectEntity(p).catch((err: unknown) => {
          logger.warn({ err, path: p }, "[markers] Failed to delete catch-entry photo on marker delete");
        }),
      ),
    );
  }

  res.status(204).send();
}));

export default router;
