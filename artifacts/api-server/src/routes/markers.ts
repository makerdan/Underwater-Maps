import { Router } from "express";
import { and, eq, sql, isNull, gte, lte, or } from "drizzle-orm";
import { db, markersTable, catchCountersTable, catchEntriesTable, datasetCatalogTable, customDatasetsTable } from "@workspace/db";
import { PostMarkersBody, DeleteMarkersIdParams, GetMarkersQueryParams, PatchMarkersIdParams, PatchMarkersIdBody, GetMarkersResponse, GetMarkersResponseItem, PatchMarkersIdResponse, DeleteMarkersMineResponse } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody, validateQuery, validateParams } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";
import { dataMutationRateLimit, bulkDeleteMarkersRateLimit } from "../middlewares/dataMutationRateLimit.js";
import { isValidBbox, isInsideBbox, type NormalisedBbox } from "../lib/bbox.js";
import { ALL_PRESET_DATASETS, BUNDLED_COVERAGE_BBOXES } from "../lib/terrain.js";

const LABEL_MAX = 200;
const NOTES_MAX = 2000;

/** UUID shape of the custom_datasets primary key. Non-UUID ids must never be
 *  queried against that column — Postgres throws
 *  `invalid input syntax for type uuid` (→ 500) instead of returning no rows. */
const CUSTOM_DATASET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the coverage bbox for a given datasetId. Ids come in three
 * families and each is resolved differently:
 *  1. Bundled preset slugs (code-defined in lib/terrain.ts, e.g.
 *     "lake-ray-roberts", "thorne-bay") — resolved first from ALL_PRESET_DATASETS
 *     (DatasetMeta entries with full bbox), then from BUNDLED_COVERAGE_BBOXES
 *     (lightweight bbox-only entries for the remaining DATASET_SOURCE_PRIORITY ids).
 *  2. Catalog ids — `dataset_catalog.coverageBbox` (JSONB).
 *  3. Custom dataset UUIDs — `custom_datasets.terrainJson`; only queried when
 *     the id is UUID-shaped (the column is typed uuid).
 *
 * A stored bbox that is malformed (missing / non-finite fields, inverted
 * bounds — see isValidBbox) is treated the same as a missing one: the
 * resolution is "not_found" so the route rejects with 404 instead of running
 * NaN comparisons in isInsideBbox.
 *
 * Exported for unit tests.
 */
export async function resolveDatasetBbox(datasetId: string): Promise<DatasetBboxResolution> {
  // 1. Bundled preset datasets defined in code.
  const preset = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (preset) {
    return { kind: "bbox", bbox: preset.bbox };
  }
  // Bundled datasets registered only in DATASET_SOURCE_PRIORITY (no
  // DatasetMeta entry) — resolve via the lightweight coverage-bbox registry.
  // hasOwnProperty guards against "__proto__" and similar prototype keys.
  if (Object.prototype.hasOwnProperty.call(BUNDLED_COVERAGE_BBOXES, datasetId)) {
    return { kind: "bbox", bbox: BUNDLED_COVERAGE_BBOXES[datasetId]! };
  }

  // 2. Check catalog datasets (coverageBbox is a JSONB blob).
  const catalogRows = await db
    .select({ coverageBbox: datasetCatalogTable.coverageBbox })
    .from(datasetCatalogTable)
    .where(eq(datasetCatalogTable.id, datasetId));

  if (catalogRows.length > 0) {
    const bbox = catalogRows[0]!.coverageBbox;
    if (isValidBbox(bbox)) {
      return { kind: "bbox", bbox: { minLon: bbox.minLon, minLat: bbox.minLat, maxLon: bbox.maxLon, maxLat: bbox.maxLat } };
    }
    // The dataset exists in the catalog but its stored bbox is unusable.
    // Do NOT fall through to the custom-datasets table: catalog IDs are
    // human-readable slugs that never appear in custom_datasets.
    return { kind: "not_found" };
  }

  // 3. Check user-uploaded datasets (bbox fields live inside terrainJson) —
  //    only for UUID-shaped ids; anything else can never match the uuid PK
  //    (Postgres would throw `invalid input syntax for type uuid`, 22P02).
  if (CUSTOM_DATASET_UUID_RE.test(datasetId)) {
    const userRows = await db
      .select({ terrainJson: customDatasetsTable.terrainJson })
      .from(customDatasetsTable)
      .where(eq(customDatasetsTable.id, datasetId));

    if (userRows.length > 0) {
      const tj = userRows[0]!.terrainJson;
      if (tj) {
        const candidate = { minLon: tj.minLon, minLat: tj.minLat, maxLon: tj.maxLon, maxLat: tj.maxLat };
        if (isValidBbox(candidate)) {
          return { kind: "bbox", bbox: candidate };
        }
      }
    }
  }

  return { kind: "not_found" };
}

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
        // A coverage bbox with minLon > maxLon crosses the antimeridian.
        // Treat it as the union of [minLon, 180] and [-180, maxLon]
        // instead of issuing an impossible single interval.
        minLon <= maxLon
          ? and(gte(markersTable.lon, minLon), lte(markersTable.lon, maxLon))
          : or(
              gte(markersTable.lon, minLon),
              lte(markersTable.lon, maxLon),
            ),
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

  // Dataset bbox guard — only when a datasetId is provided.
  if (datasetId != null) {
    const resolution = await resolveDatasetBbox(datasetId);
    if (resolution.kind === "not_found") {
      res.status(404).json({ error: "not_found", message: "Dataset not found" });
      return;
    }
    if (resolution.kind === "bbox" && !isInsideBbox(lon, lat, resolution.bbox)) {
      res.status(422).json({ error: "validation_error", message: "Marker coordinates are outside the dataset's coverage area" });
      return;
    }
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

  // Semantic depth validation — must be finite and non-negative.
  if (updateData.depth !== undefined) {
    if (!Number.isFinite(updateData.depth) || updateData.depth < 0) {
      res.status(422).json({ error: "validation_error", field: "depth", message: "depth must be a finite number ≥ 0" });
      return;
    }
  }

  // Dataset bbox guard — only when the request body explicitly supplies a
  // datasetId (non-null). Patching only label/notes/depth leaves this field
  // absent entirely, so the check is skipped. Passing datasetId: null is
  // valid (un-assignment) and also skips the check.
  if ("datasetId" in updateData && updateData.datasetId != null) {
    const resolution = await resolveDatasetBbox(updateData.datasetId);
    if (resolution.kind === "not_found") {
      res.status(404).json({ error: "not_found", message: "Dataset not found" });
      return;
    }
    if (resolution.kind === "bbox") {
      // We need the marker's current lon/lat to check against the new dataset's bbox.
      // Fetch the marker first (ownership-scoped) so we always check the real coords.
      const [existing] = await db
        .select({ lon: markersTable.lon, lat: markersTable.lat })
        .from(markersTable)
        .where(and(eq(markersTable.id, id), eq(markersTable.userId, userId)));
      if (!existing) {
        res.status(404).json({ error: "not_found", details: `Marker '${id}' not found` });
        return;
      }
      const lon = (updateData as { lon?: number }).lon ?? existing.lon;
      const lat = (updateData as { lat?: number }).lat ?? existing.lat;
      if (!isInsideBbox(lon, lat, resolution.bbox)) {
        res.status(422).json({ error: "validation_error", message: "Marker coordinates are outside the dataset's coverage area" });
        return;
      }
    }
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
  //
  // IMPORTANT: the WHERE clause must include userId so that an attacker who
  // guesses or brute-forces another user's marker UUID cannot cause this
  // handler to expose (prefetch) that user's photo storage paths — even though
  // the subsequent marker delete is already owner-scoped and returns 404.
  const entries = await db
    .select({ photos: catchEntriesTable.photos })
    .from(catchEntriesTable)
    .where(and(eq(catchEntriesTable.markerId, id), eq(catchEntriesTable.userId, userId)));

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

/**
 * Result of resolving a datasetId's coverage:
 *  - "bbox"      — dataset found, coverage bbox available → enforce the guard.
 *  - "not_found" — datasetId is unknown everywhere → 404.
 */
export type DatasetBboxResolution =
  | { kind: "bbox"; bbox: NormalisedBbox }
  | { kind: "not_found" };
