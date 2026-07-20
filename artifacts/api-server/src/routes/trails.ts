import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, gpsTrailsTable, gpsTrailPointsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { validateBody } from "../middlewares/validateBody.js";
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

  res.json(rows);
}));

// ---------------------------------------------------------------------------
// POST /trails
// ---------------------------------------------------------------------------
router.post("/trails", trailUploadRateLimit, requireAuth, dataMutationRateLimit, validateBody(PostTrailBodySchema, "POST /api/trails"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const { datasetId, name, colour, startedAt, endedAt, points } = res.locals.parsedBody;

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
      const CHUNK = 500;
      for (let i = 0; i < pointRows.length; i += CHUNK) {
        await tx.insert(gpsTrailPointsTable).values(pointRows.slice(i, i + CHUNK));
        if (i + CHUNK < pointRows.length) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    }

    return created;
  });

  res.status(201).json(trail);
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
