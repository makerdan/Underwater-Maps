import { Router } from "express";
import { and, eq, sql, isNull, gte, lte } from "drizzle-orm";
import { db, markersTable, catchCountersTable, catchEntriesTable } from "@workspace/db";
import { PostMarkersBody, DeleteMarkersIdParams, GetMarkersQueryParams, PatchMarkersIdParams, PatchMarkersIdBody, GetMarkersResponse, GetMarkersResponseItem, PatchMarkersIdResponse, DeleteMarkersMineResponse } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateQuery, validateParams } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { dataMutationRateLimit, bulkDeleteMarkersRateLimit } from "../middlewares/dataMutationRateLimit.js";

const LABEL_MAX = 200;
const NOTES_MAX = 2000;

const router = Router();

router.get("/markers", requireAuth, validateQuery(GetMarkersQueryParams, "GET /api/markers"), asyncHandler(async (req, res): Promise<void> => {
  const { datasetId, minLat, minLon, maxLat, maxLon } = res.locals.parsedQuery;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  if (datasetId !== undefined && datasetId !== "") {
    // Standard mode: return markers for the given dataset owned by this user.
    const rows = await db
      .select()
      .from(markersTable)
      .where(and(eq(markersTable.datasetId, datasetId), eq(markersTable.userId, userId)))
      .orderBy(markersTable.createdAt);
    res.json(validateResponse(GetMarkersResponse, rows, "GET /api/markers"));
    return;
  }

  // Bounds mode: return unassigned markers (datasetId IS NULL) within the given bbox.
  if (
    minLat === undefined || minLon === undefined ||
    maxLat === undefined || maxLon === undefined
  ) {
    res.status(400).json({
      error: "invalid_request",
      details: "Provide either datasetId or all four bounds params (minLat, minLon, maxLat, maxLon).",
    });
    return;
  }

  const rows = await db
    .select()
    .from(markersTable)
    .where(
      and(
        eq(markersTable.userId, userId),
        isNull(markersTable.datasetId),
        gte(markersTable.lat, minLat),
        lte(markersTable.lat, maxLat),
        gte(markersTable.lon, minLon),
        lte(markersTable.lon, maxLon),
      ),
    )
    .orderBy(markersTable.createdAt);

  res.json(validateResponse(GetMarkersResponse, rows, "GET /api/markers (bounds)"));
}));

router.post("/markers", requireAuth, dataMutationRateLimit, validateBody(PostMarkersBody, "POST /api/markers"), asyncHandler(async (req, res): Promise<void> => {
  const { datasetId, lon, lat, depth, type = "custom", label, notes, quickCatch, conditions } = res.locals.parsedBody;
  const userId = (req as AuthenticatedRequest).clerkUserId;

  // Semantic validation — return 422 Unprocessable Entity for out-of-range values.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    res.status(422).json({ error: "validation_error", field: "lat", message: "lat must be a finite number between -90 and 90" });
    return;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    res.status(422).json({ error: "validation_error", field: "lon", message: "lon must be a finite number between -180 and 180" });
    return;
  }
  const trimmedLabel = (label ?? "").trim();
  if (!trimmedLabel || trimmedLabel.length === 0) {
    res.status(422).json({ error: "validation_error", field: "label", message: "label must not be empty after trimming" });
    return;
  }
  if (trimmedLabel.length > LABEL_MAX) {
    res.status(422).json({ error: "validation_error", field: "label", message: `label must be at most ${LABEL_MAX} characters` });
    return;
  }
  const trimmedNotes = notes ? notes.trim() : null;
  if (trimmedNotes && trimmedNotes.length > NOTES_MAX) {
    res.status(422).json({ error: "validation_error", field: "notes", message: `notes must be at most ${NOTES_MAX} characters` });
    return;
  }

  let finalLabel = trimmedLabel;
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
      datasetId: datasetId ?? null,
      lon,
      lat,
      depth,
      type,
      label: finalLabel,
      notes: trimmedNotes ?? null,
      userId,
      catchSeq,
      conditions: conditionsJson,
    })
    .returning();

  res.status(201).json(validateResponse(GetMarkersResponseItem, created, "POST /api/markers"));
}));

router.delete("/markers/mine", requireAuth, bulkDeleteMarkersRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const deleted = await db
    .delete(markersTable)
    .where(eq(markersTable.userId, userId))
    .returning({ id: markersTable.id });

  res.json(validateResponse(DeleteMarkersMineResponse, { deleted: deleted.length }, "DELETE /api/markers/mine"));
}));

router.patch("/markers/:id", requireAuth, dataMutationRateLimit, validateParams(PatchMarkersIdParams, "PATCH /api/markers/:id", { details: "Invalid marker id" }), validateBody(PatchMarkersIdBody, "PATCH /api/markers/:id"), asyncHandler(async (req, res): Promise<void> => {
  const { id } = res.locals.parsedParams;
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

  res.json(validateResponse(PatchMarkersIdResponse, updated, "PATCH /api/markers/:id"));
}));

router.delete("/markers/:id", requireAuth, dataMutationRateLimit, validateParams(DeleteMarkersIdParams, "DELETE /api/markers/:id", { details: "Invalid marker id" }), asyncHandler(async (req, res): Promise<void> => {
  const { id } = res.locals.parsedParams;
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
