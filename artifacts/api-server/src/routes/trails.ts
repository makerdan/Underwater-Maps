import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, gpsTrailsTable, gpsTrailPointsTable } from "@workspace/db";
import { GetTrailsResponse, GetTrailsResponseItem } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
import { z } from "zod";

const trailUploadRateLimit = createRateLimit({
  route: "trail-upload",
  windowMs: 60_000,
  max: 10,
  mode: "ip",
});

const router = Router();

// ---------------------------------------------------------------------------
// Shared zod schemas
// ---------------------------------------------------------------------------

// Min/max years accepted for GPS timestamps (server-side range guard).
// Timestamps outside [2000, 2100] are almost certainly programmer errors,
// clock corruption, or deliberate injection — not real recorded positions.
const GPS_TIMESTAMP_MIN_YEAR = 2000;
const GPS_TIMESTAMP_MAX_YEAR = 2100;

const GpsPointSchema = z.object({
  lon: z.number(),
  lat: z.number(),
  accuracy: z.number().default(0),
  timestamp: z.number(),
  seq: z.number().int().default(0),
});

const PostTrailBodySchema = z.object({
  datasetId: z.string().min(1),
  name: z.string().min(1).max(120),
  colour: z.string().default("#ff6600"),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  points: z.array(GpsPointSchema).min(1).max(50_000),
});

const GetTrailsQuerySchema = z.object({
  datasetId: z.string().min(1),
});

const TrailIdParamSchema = z.object({
  id: z.string().uuid(),
});

const GetPointsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
});

// ---------------------------------------------------------------------------
// GET /trails?datasetId=
// ---------------------------------------------------------------------------
router.get("/trails", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const parsed = GetTrailsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "datasetId query parameter is required" });
    return;
  }

  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { datasetId } = parsed.data;

  const rows = await db
    .select()
    .from(gpsTrailsTable)
    .where(
      and(
        eq(gpsTrailsTable.userId, userId),
        eq(gpsTrailsTable.datasetId, datasetId),
      ),
    )
    .orderBy(gpsTrailsTable.startedAt);

  res.json(validateResponse(GetTrailsResponse, rows, "GET /api/trails"));
}));

// ---------------------------------------------------------------------------
// POST /trails
// ---------------------------------------------------------------------------
router.post("/trails", trailUploadRateLimit, requireAuth, dataMutationRateLimit, validateBody(PostTrailBodySchema, "POST /api/trails"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { datasetId, name, colour, startedAt, endedAt, points } = res.locals.parsedBody;

  // -------------------------------------------------------------------------
  // Semantic validation — check each GPS point for geographic range and a
  // reasonable timestamp.  Zod rejects wrong types (400); we return 422 for
  // valid-typed but out-of-range values so the client can identify the bad
  // point.  Checking here (post-parse) lets us give a precise field/value
  // message rather than a generic schema error.
  // -------------------------------------------------------------------------
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { lon: number; lat: number; accuracy?: number; timestamp: number; seq?: number };

    if (!Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90) {
      res.status(422).json({
        error: "validation_error",
        field: "lat",
        index: i,
        message: `points[${i}].lat must be a finite number between -90 and 90`,
      });
      return;
    }

    if (!Number.isFinite(p.lon) || p.lon < -180 || p.lon > 180) {
      res.status(422).json({
        error: "validation_error",
        field: "lon",
        index: i,
        message: `points[${i}].lon must be a finite number between -180 and 180`,
      });
      return;
    }

    const d = new Date(p.timestamp);
    const year = d.getUTCFullYear();
    if (isNaN(d.getTime()) || year < GPS_TIMESTAMP_MIN_YEAR || year > GPS_TIMESTAMP_MAX_YEAR) {
      res.status(422).json({
        error: "validation_error",
        field: "timestamp",
        index: i,
        message: `points[${i}].timestamp must be a valid date between ${GPS_TIMESTAMP_MIN_YEAR} and ${GPS_TIMESTAMP_MAX_YEAR}`,
      });
      return;
    }
  }

  const trail = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(gpsTrailsTable)
      .values({
        userId,
        datasetId,
        name,
        colour,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        pointCount: points.length,
      })
      .returning();

    if (!created) throw new Error("Failed to create trail");

    let actualCount = 0;

    if (points.length > 0) {
      const pointRows = points.map((p: { lon: number; lat: number; accuracy?: number; timestamp: number; seq?: number }, i: number) => ({
        trailId: created.id,
        seq: p.seq ?? i,
        lon: p.lon,
        lat: p.lat,
        accuracy: p.accuracy ?? 0,
        recordedAt: new Date(p.timestamp),
      }));

      // Bulk-insert in chunks of 500 to avoid query size limits.
      // Yield between chunks so a large upload (up to 50 k points) does
      // not monopolise the Node.js event loop for its entire duration.
      // onConflictDoNothing guards against retry-induced phantom points:
      // if the client retries a failed upload the (trail_id, seq) unique
      // index would otherwise produce a duplicate-key error.
      //
      // We use returning() to count only rows that were actually inserted —
      // onConflictDoNothing silently skips duplicates, so points.length may
      // overcount. pointCount must reflect actual stored rows so paginated
      // retrieval returns the right total.
      const CHUNK = 500;
      for (let i = 0; i < pointRows.length; i += CHUNK) {
        const inserted = await tx
          .insert(gpsTrailPointsTable)
          .values(pointRows.slice(i, i + CHUNK))
          .onConflictDoNothing()
          .returning({ id: gpsTrailPointsTable.id });
        actualCount += inserted.length;
        if (i + CHUNK < pointRows.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }

    // Update pointCount to the number of rows actually written.  This differs
    // from points.length only when the client submitted duplicate seq values
    // (e.g. a retried upload that already partially landed).
    if (actualCount !== points.length) {
      await tx
        .update(gpsTrailsTable)
        .set({ pointCount: actualCount })
        .where(eq(gpsTrailsTable.id, created.id));
      return { ...created, pointCount: actualCount };
    }

    return created;
  });

  res.status(201).json(validateResponse(GetTrailsResponseItem, trail, "POST /api/trails"));
}));

// ---------------------------------------------------------------------------
// DELETE /trails/:id
// ---------------------------------------------------------------------------
router.delete("/trails/:id", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const parsed = TrailIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid trail id" });
    return;
  }

  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { id } = parsed.data;

  const deleted = await db
    .delete(gpsTrailsTable)
    .where(and(eq(gpsTrailsTable.id, id), eq(gpsTrailsTable.userId, userId)))
    .returning({ id: gpsTrailsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `Trail '${id}' not found or not owned by you` });
    return;
  }

  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// POST /trails/:id/soft-delete  (beacon fallback for beforeunload)
// ---------------------------------------------------------------------------
// Called by navigator.sendBeacon on page unload so pending deletes survive
// tab-close without needing an async auth-token lookup.  Authentication relies
// on the session cookie that the browser includes automatically with the beacon.
// This route is intentionally identical in effect to DELETE /trails/:id.
router.post("/trails/:id/soft-delete", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const parsed = TrailIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid trail id" });
    return;
  }

  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { id } = parsed.data;

  const deleted = await db
    .delete(gpsTrailsTable)
    .where(and(eq(gpsTrailsTable.id, id), eq(gpsTrailsTable.userId, userId)))
    .returning({ id: gpsTrailsTable.id });

  if (!deleted.length) {
    // Return 204 rather than 404 — a beacon fired on unload may arrive after a
    // normal DELETE has already committed, so "already gone" is not an error.
    res.status(204).send();
    return;
  }

  res.status(204).send();
}));

// ---------------------------------------------------------------------------
// GET /trails/:id/points?page=1&pageSize=200
// ---------------------------------------------------------------------------
router.get("/trails/:id/points", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const paramParsed = TrailIdParamSchema.safeParse(req.params);
  const queryParsed = GetPointsQuerySchema.safeParse(req.query);

  if (!paramParsed.success) {
    res.status(400).json({ error: "invalid_request", details: "Invalid trail id" });
    return;
  }
  if (!queryParsed.success) {
    res.status(400).json({ error: "invalid_request", details: queryParsed.error.message });
    return;
  }

  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { id } = paramParsed.data;
  const { page, pageSize } = queryParsed.data;

  // Verify trail belongs to this user
  const [trail] = await db
    .select({ id: gpsTrailsTable.id, pointCount: gpsTrailsTable.pointCount })
    .from(gpsTrailsTable)
    .where(and(eq(gpsTrailsTable.id, id), eq(gpsTrailsTable.userId, userId)));

  if (!trail) {
    res.status(404).json({ error: "not_found", details: `Trail '${id}' not found` });
    return;
  }

  const points = await db
    .select()
    .from(gpsTrailPointsTable)
    .where(eq(gpsTrailPointsTable.trailId, id))
    .orderBy(gpsTrailPointsTable.seq)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({
    points: points.map((p) => ({
      lon: p.lon,
      lat: p.lat,
      accuracy: p.accuracy,
      timestamp: p.recordedAt.getTime(),
      seq: p.seq,
    })),
    total: trail.pointCount,
    page,
    pageSize,
  });
}));

export default router;
