import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, customDatasetsTable, datasetFoldersTable, type StoredTerrainJson, type GeorefControlPoint, type StoredTideStation } from "@workspace/db";
import { MAX_TERRAIN_JSON_BYTES } from "../lib/constants.js";
import {
  GetUserDatasetsResponse,
  GetUserDatasetsIdTerrainResponse,
  GetUserDatasetsIdOverviewResponse,
  PatchUserDatasetsIdMoveBody,
  PatchUserDatasetsIdMoveResponse,
  PatchUserDatasetsIdRenameBody,
  PatchUserDatasetsIdRenameResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { gunzipBounded } from "../lib/gunzipBounded.js";
import sharp from "sharp";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { validateBody } from "../middlewares/validateBody.js";
import { logger } from "../lib/logger.js";

const router = Router();

const terrainFetchIpRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 90,
  mode: "ip",
});

const terrainFetchUserRateLimit = createRateLimit({
  route: "terrain-fetch",
  windowMs: 60_000,
  max: 30,
  mode: "user",
});

function metaJson(row: {
  id: string;
  name: string;
  minDepth: number;
  maxDepth: number;
  folderId: string | null;
  createdAt: Date;
  needsGeoreferencing?: boolean | null;
  pendingRasterGzBase64?: string | null;
  tideStationJson?: StoredTideStation | null;
}) {
  return {
    id: row.id,
    name: row.name,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
    folderId: row.folderId,
    createdAt: row.createdAt.toISOString(),
    ...(row.needsGeoreferencing ? { needsGeoreferencing: true as const } : {}),
    ...(row.needsGeoreferencing && row.pendingRasterGzBase64
      ? { hasRasterImage: true as const }
      : {}),
    ...(row.tideStationJson ? { tideStation: row.tideStationJson } : {}),
  };
}

/** Zod schema for a single georeferencing control point. */
const GeorefControlPointSchema = z.object({
  px: z.number().finite().nonnegative(),
  py: z.number().finite().nonnegative(),
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
});

/** Body schema for POST /user/datasets/:id/georef. */
const GeorefBodySchema = z.object({
  controlPoints: z.array(GeorefControlPointSchema).min(2).max(4),
});

// ── GET /user/datasets ─────────────────────────────────────────────────────
router.get("/user/datasets", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;

  const rows = await db
    .select({
      id: customDatasetsTable.id,
      name: customDatasetsTable.name,
      minDepth: customDatasetsTable.minDepth,
      maxDepth: customDatasetsTable.maxDepth,
      folderId: customDatasetsTable.folderId,
      createdAt: customDatasetsTable.createdAt,
      needsGeoreferencing: customDatasetsTable.needsGeoreferencing,
      pendingRasterGzBase64: customDatasetsTable.pendingRasterGzBase64,
      tideStationJson: customDatasetsTable.tideStationJson,
    })
    .from(customDatasetsTable)
    .where(eq(customDatasetsTable.userId, userId))
    .orderBy(desc(customDatasetsTable.createdAt));

  res.json(GetUserDatasetsResponse.parse(rows.map(metaJson)));
}));

// ── PATCH /user/datasets/:id/move ──────────────────────────────────────────
router.patch("/user/datasets/:id/move", requireAuth, validateBody(PatchUserDatasetsIdMoveBody, "PATCH /api/user/datasets/:id/move"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  const { folderId: rawFolderId } = res.locals.parsedBody;
  const folderId = rawFolderId ?? null;

  if (folderId !== null) {
    const [folder] = await db
      .select({ id: datasetFoldersTable.id })
      .from(datasetFoldersTable)
      .where(and(eq(datasetFoldersTable.id, folderId), eq(datasetFoldersTable.userId, userId)));
    if (!folder) {
      res.status(400).json({ error: "invalid_parent", details: "Folder not found" });
      return;
    }
  }

  const [updated] = await db
    .update(customDatasetsTable)
    .set({ folderId })
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }
  res.json(PatchUserDatasetsIdMoveResponse.parse(metaJson(updated)));
}));

// ── PATCH /user/datasets/:id/rename ────────────────────────────────────────
router.patch("/user/datasets/:id/rename", requireAuth, validateBody(PatchUserDatasetsIdRenameBody, "PATCH /api/user/datasets/:id/rename"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");
  const { name: rawName } = res.locals.parsedBody;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.length > 200) {
    res.status(400).json({ error: "invalid_name", details: "Name must be 1–200 chars" });
    return;
  }

  const [updated] = await db
    .update(customDatasetsTable)
    .set({ name })
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }
  res.json(PatchUserDatasetsIdRenameResponse.parse(metaJson(updated)));
}));

// ── POST /user/datasets/:id/duplicate ──────────────────────────────────────
router.post("/user/datasets/:id/duplicate", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [source] = await db
    .select()
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));
  if (!source) {
    res.status(404).json({ error: "not_found", details: "Dataset not found" });
    return;
  }

  const [created] = await db
    .insert(customDatasetsTable)
    .values({
      userId,
      name: `${source.name} (copy)`,
      minDepth: source.minDepth,
      maxDepth: source.maxDepth,
      terrainJson: source.terrainJson,
      overviewJson: source.overviewJson,
      folderId: source.folderId,
      tideStationJson: source.tideStationJson,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "db_error", details: "Could not duplicate" });
    return;
  }

  // Rewrite the embedded `datasetId` so the duplicated row's grids identify
  // as the new row, not the source. The client's load path treats this id as
  // the source of truth and will rebrand on read, but stamping here keeps the
  // stored payload internally consistent for future tooling.
  const dupTerrain = {
    ...(source.terrainJson as unknown as Record<string, unknown>),
    datasetId: created.id,
  } as unknown as StoredTerrainJson;
  const dupOverview = {
    ...(source.overviewJson as unknown as Record<string, unknown>),
    datasetId: created.id,
  } as unknown as StoredTerrainJson;
  await db
    .update(customDatasetsTable)
    .set({ terrainJson: dupTerrain, overviewJson: dupOverview })
    .where(eq(customDatasetsTable.id, created.id));

  res.status(201).json(metaJson(created));
}));

// ── GET /user/datasets/:id/terrain ─────────────────────────────────────────
router.get("/user/datasets/:id/terrain", terrainFetchIpRateLimit, requireAuth, terrainFetchUserRateLimit, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  // Size pre-check: read pg_column_size without loading the blob into Node.js
  // heap. A pathologically large blob (e.g. a dense 1024×1024 grid) would
  // spike heap twice (DB result + JSON.stringify) and could OOM the process
  // under concurrent load. Fail fast here before touching the full column.
  const [sizeRow] = await db
    .select({ size: sql<number>`pg_column_size(${customDatasetsTable.terrainJson})` })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!sizeRow) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  if (sizeRow.size > MAX_TERRAIN_JSON_BYTES) {
    logger.warn(
      { datasetId: id, sizeBytes: sizeRow.size, limitBytes: MAX_TERRAIN_JSON_BYTES },
      `[terrain] dataset ${id} terrain_json is ${sizeRow.size} bytes ` +
      `(limit ${MAX_TERRAIN_JSON_BYTES}) — returning 413`,
    );
    res.status(413).json({
      error: "payload_too_large",
      details: "Dataset is too large to load in the browser. Please contact support.",
    });
    return;
  }

  const [row] = await db
    .select({ terrainJson: customDatasetsTable.terrainJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.json(GetUserDatasetsIdTerrainResponse.parse(row.terrainJson));
}));

// ── GET /user/datasets/:id/overview ────────────────────────────────────────
router.get("/user/datasets/:id/overview", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({ overviewJson: customDatasetsTable.overviewJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.json(GetUserDatasetsIdOverviewResponse.parse(row.overviewJson));
}));

// ── GET /user/datasets/:id/raster-image ────────────────────────────────────
// Returns the stored pending raster as a JSON envelope containing base64 gzip
// bytes.  The client decodes → decompresses → parses via geotiff.js and renders
// to a canvas for the georeferencing wizard.
router.get("/user/datasets/:id/raster-image", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({
      pendingRasterGzBase64: customDatasetsTable.pendingRasterGzBase64,
      needsGeoreferencing: customDatasetsTable.needsGeoreferencing,
    })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  if (!row.needsGeoreferencing || !row.pendingRasterGzBase64) {
    res.status(404).json({ error: "no_raster", details: "This dataset has no pending raster image available for georeferencing." });
    return;
  }

  // Decompress gz → raw TIF bytes
  const gzBuf = Buffer.from(row.pendingRasterGzBase64, "base64");
  let tifBuf: Buffer;
  try {
    tifBuf = await gunzipBounded(gzBuf, 200 * 1024 * 1024);
  } catch {
    res.status(500).json({ error: "decompress_failed", details: "Could not decompress the raster image." });
    return;
  }

  // Convert TIFF to JPEG via sharp (TIFF may be grayscale or RGB)
  let pngBuf: Buffer;
  try {
    pngBuf = await sharp(tifBuf)
      .toColorspace("srgb")
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    res.status(500).json({ error: "convert_failed", details: "Could not convert raster to JPEG." });
    return;
  }

  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "private, max-age=3600");
  res.send(pngBuf);
}));

// ── POST /user/datasets/:id/georef ─────────────────────────────────────────
// Accepts 2–4 control points mapping pixel coordinates to WGS84 lon/lat,
// persists them, clears the pending raster blob (to save DB space), and
// marks the dataset as no longer requiring georeferencing.
router.post("/user/datasets/:id/georef", requireAuth, validateBody(GeorefBodySchema, "POST /api/user/datasets/:id/georef"), asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const controlPoints: GeorefControlPoint[] = res.locals.parsedBody.controlPoints;

  const [row] = await db
    .select({ id: customDatasetsTable.id, needsGeoreferencing: customDatasetsTable.needsGeoreferencing })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  if (!row.needsGeoreferencing) {
    res.status(409).json({ error: "not_pending", details: "This dataset does not have a pending georeferencing request." });
    return;
  }

  const [updated] = await db
    .update(customDatasetsTable)
    .set({
      georefControlPointsJson: controlPoints,
      needsGeoreferencing: false,
      pendingRasterGzBase64: null,
    })
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning({
      id: customDatasetsTable.id,
      name: customDatasetsTable.name,
      minDepth: customDatasetsTable.minDepth,
      maxDepth: customDatasetsTable.maxDepth,
      folderId: customDatasetsTable.folderId,
      createdAt: customDatasetsTable.createdAt,
      needsGeoreferencing: customDatasetsTable.needsGeoreferencing,
      pendingRasterGzBase64: customDatasetsTable.pendingRasterGzBase64,
    });

  if (!updated) {
    res.status(500).json({ error: "db_error", details: "Could not update dataset" });
    return;
  }

  res.json(metaJson(updated));
}));

// ── GET /user/datasets/:id/hyd93-features ──────────────────────────────────
router.get("/user/datasets/:id/hyd93-features", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const [row] = await db
    .select({ hyd93FeaturesJson: customDatasetsTable.hyd93FeaturesJson })
    .from(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)));

  if (!row) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  // Return an empty array when the dataset has no HYD93 annotation features
  // (e.g. it was not sourced from an a93.gz archive, or contained no annotation rows).
  res.json(row.hyd93FeaturesJson ?? []);
}));

// ── DELETE /user/datasets/:id ───────────────────────────────────────────────
router.delete("/user/datasets/:id", requireAuth, asyncHandler(async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).clerkUserId;
  const id = String(req.params["id"] ?? "");

  const deleted = await db
    .delete(customDatasetsTable)
    .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
    .returning({ id: customDatasetsTable.id });

  if (!deleted.length) {
    res.status(404).json({ error: "not_found", details: `User dataset '${id}' not found` });
    return;
  }

  res.status(204).send();
}));

export default router;
