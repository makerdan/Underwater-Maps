import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, customDatasetsTable, datasetFoldersTable, userCatalogSavesTable, type StoredTerrainJson, type GeorefControlPoint, type StoredTideStation } from "@workspace/db";
import { MAX_TERRAIN_JSON_BYTES } from "../lib/constants.js";
import {
  GetUserDatasetsResponse,
  GetUserDatasetsIdTerrainResponse,
  GetUserDatasetsIdOverviewResponse,
  PatchUserDatasetsIdMoveBody,
  PatchUserDatasetsIdMoveResponse,
  PatchUserDatasetsIdRenameBody,
  PatchUserDatasetsIdRenameResponse,
  PostUserDatasetsIdGeorefResponse,
  GetUserDatasetsIdHyd93FeaturesResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { gunzipBounded } from "../lib/gunzipBounded.js";
import sharp from "sharp";

/**
 * Sanitizes a stored terrain/overview JSON blob before it is passed to the
 * Zod schema parser.  Two legacy issues can cause strict Zod validation to
 * throw a 500:
 *
 *  1. Pre-freshwater rows (before 2026-07-19) have no `waterType` field.
 *     These default to `fallbackWaterType` — "saltwater" unless the caller
 *     resolved a better value (e.g. the linked catalog entry's waterType via
 *     resolveCatalogWaterType), because every *upload* that predates the
 *     freshwater feature is a saltwater/ocean dataset, but catalog saves may
 *     be freshwater (e.g. Lake Ray Roberts).
 *
 *  2. Old rows may carry `dataSource: "synthetic"` — the fbm procedural
 *     fallback was removed; "synthetic" is no longer a valid enum value.
 *     We delete the field so the optional `dataSource` is simply absent.
 *
 * This is a read-path shim; no DB backfill required.
 */
const VALID_WATER_TYPES = new Set(["saltwater", "freshwater"]);

type WaterType = "saltwater" | "freshwater";

export function sanitizeLegacyStoredJson(
  raw: unknown,
  fallbackWaterType: WaterType = "saltwater",
): Record<string, unknown> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...obj };

  // 1. Inject missing waterType
  if (!VALID_WATER_TYPES.has(patched["waterType"] as string)) {
    patched["waterType"] = fallbackWaterType;
  }

  // 2. Strip removed "synthetic" dataSource
  if (patched["dataSource"] === "synthetic") {
    delete patched["dataSource"];
  }

  return patched;
}

/** True when the stored JSON already carries a valid waterType. */
function hasValidWaterType(raw: unknown): boolean {
  const obj = raw as Record<string, unknown> | null | undefined;
  return VALID_WATER_TYPES.has(obj?.["waterType"] as string);
}

/**
 * Legacy read-path fix: for a custom_datasets row whose stored JSON predates
 * the freshwater feature (no `waterType`), resolve the correct water type
 * from the linked catalog save (user_catalog_saves.dataset_id → catalogId →
 * catalog entry). Returns null when the dataset has no linked save, the
 * catalog entry is gone, or anything about the lookup is off — callers then
 * fall back to the legacy "saltwater" default.
 */
async function resolveCatalogWaterType(datasetId: string): Promise<WaterType | null> {
  try {
    const [save] = await db
      .select({ catalogId: userCatalogSavesTable.catalogId })
      .from(userCatalogSavesTable)
      .where(eq(userCatalogSavesTable.datasetId, datasetId));
    if (!save || typeof save.catalogId !== "string" || !save.catalogId) return null;

    const entries = await getCatalogEntries();
    const entry = entries.find((e) => e.id === save.catalogId);
    const wt = entry?.waterType;
    return wt === "saltwater" || wt === "freshwater" ? wt : null;
  } catch (err) {
    logger.warn(
      { datasetId, err },
      "[user-datasets] catalog waterType lookup failed — falling back to saltwater",
    );
    return null;
  }
}
import { getCatalogEntries } from "../lib/catalogSeeder.js";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { createRateLimit } from "../middlewares/rateLimit.js";
import { dataMutationRateLimit } from "../middlewares/dataMutationRateLimit.js";
import { validateBody } from "../middlewares/validateBody.js";
import { validateResponse } from "../middlewares/validateResponse.js";
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

function extractBbox(
  terrainJson: StoredTerrainJson | null | undefined,
  overviewJson: StoredTerrainJson | null | undefined,
): { minLon: number; maxLon: number; minLat: number; maxLat: number } | null {
  // Prefer terrainJson (higher-res grid); fall back to overviewJson.
  for (const json of [terrainJson, overviewJson]) {
    if (!json) continue;
    const { minLon, maxLon, minLat, maxLat } = json;
    if (
      typeof minLon === "number" && isFinite(minLon) &&
      typeof maxLon === "number" && isFinite(maxLon) &&
      typeof minLat === "number" && isFinite(minLat) &&
      typeof maxLat === "number" && isFinite(maxLat)
    ) {
      return { minLon, maxLon, minLat, maxLat };
    }
  }
  return null;
}

/**
 * Compute the approximate horizontal grid resolution in metres from a stored
 * terrain grid.  Uses the bbox extent and cell count — the same formula used
 * by the client-side `estimatePackStorageBytesFromBbox`.
 *
 * Returns undefined when the grid lacks valid dimensions or bbox.
 */
function extractResolutionM(grid: StoredTerrainJson | null | undefined): number | undefined {
  if (!grid) return undefined;
  const { width, height, minLon, maxLon, minLat, maxLat } = grid;
  if (!(width > 0) || !(height > 0)) return undefined;
  if (!isFinite(minLon) || !isFinite(maxLon) || !isFinite(minLat) || !isFinite(maxLat)) return undefined;
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0, Math.cos((midLat * Math.PI) / 180));
  const widthM = Math.abs(maxLon - minLon) * 111_000 * cosLat;
  const heightM = Math.abs(maxLat - minLat) * 111_000;
  const resM = (widthM / width + heightM / height) / 2;
  return resM > 0 ? resM : undefined;
}

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
  terrainJson?: StoredTerrainJson | null;
  overviewJson?: StoredTerrainJson | null;
}) {
  const bbox = extractBbox(row.terrainJson, row.overviewJson);
  // Water type from the stored grids. When a grid is present but carries no
  // valid value (legacy pre-2026-07-19 rows), default to "saltwater" — the
  // same read-path shim as sanitizeLegacyStoredJson. When no grid exists at
  // all (e.g. pending georeferencing), omit the field so the client keeps the
  // row visible in both water modes instead of guessing.
  const storedJson = row.terrainJson ?? row.overviewJson;
  const waterType: WaterType | undefined =
    storedJson == null
      ? undefined
      : hasValidWaterType(storedJson)
        ? ((storedJson as unknown as Record<string, unknown>)["waterType"] as WaterType)
        : "saltwater";
  // Resolution from the stored terrain grid (preferred) or overview fallback.
  // terrainJson uses the full-resolution grid — the better source for storage estimates.
  const resolutionM = extractResolutionM(row.terrainJson ?? row.overviewJson);
  return {
    id: row.id,
    name: row.name,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
    folderId: row.folderId,
    createdAt: row.createdAt.toISOString(),
    ...(waterType ? { waterType } : {}),
    ...(row.needsGeoreferencing ? { needsGeoreferencing: true as const } : {}),
    ...(row.needsGeoreferencing && row.pendingRasterGzBase64
      ? { hasRasterImage: true as const }
      : {}),
    ...(row.tideStationJson ? { tideStation: row.tideStationJson } : {}),
    ...(bbox !== null ? { bbox } : {}),
    ...(resolutionM !== undefined ? { resolutionM } : {}),
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
      terrainJson: customDatasetsTable.terrainJson,
      overviewJson: customDatasetsTable.overviewJson,
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
router.post("/user/datasets/:id/duplicate", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
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

  // Legacy rows (no stored waterType): prefer the linked catalog entry's
  // known water type over the blanket "saltwater" default.
  const terrainFallback = hasValidWaterType(row.terrainJson)
    ? undefined
    : await resolveCatalogWaterType(id);

  // Write-back: once resolved, persist the waterType into the stored JSON so
  // subsequent reads are self-describing and skip this extra catalog lookup.
  if (terrainFallback != null) {
    const patched = {
      ...(row.terrainJson as unknown as Record<string, unknown>),
      waterType: terrainFallback,
    };
    db.update(customDatasetsTable)
      .set({ terrainJson: patched as unknown as StoredTerrainJson })
      .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
      .catch((err: unknown) => {
        logger.warn(
          { datasetId: id, err },
          "[user-datasets] terrain waterType write-back failed — will retry on next fetch",
        );
      });
  }

  res.json(GetUserDatasetsIdTerrainResponse.parse(
    sanitizeLegacyStoredJson(row.terrainJson, terrainFallback ?? "saltwater"),
  ));
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

  // Legacy rows (no stored waterType): prefer the linked catalog entry's
  // known water type over the blanket "saltwater" default.
  const overviewFallback = hasValidWaterType(row.overviewJson)
    ? undefined
    : await resolveCatalogWaterType(id);

  // Write-back: once resolved, persist the waterType into the stored JSON so
  // subsequent reads are self-describing and skip this extra catalog lookup.
  if (overviewFallback != null) {
    const patched = {
      ...(row.overviewJson as unknown as Record<string, unknown>),
      waterType: overviewFallback,
    };
    db.update(customDatasetsTable)
      .set({ overviewJson: patched as unknown as StoredTerrainJson })
      .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, userId)))
      .catch((err: unknown) => {
        logger.warn(
          { datasetId: id, err },
          "[user-datasets] overview waterType write-back failed — will retry on next fetch",
        );
      });
  }

  res.json(GetUserDatasetsIdOverviewResponse.parse(
    sanitizeLegacyStoredJson(row.overviewJson, overviewFallback ?? "saltwater"),
  ));
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
router.post("/user/datasets/:id/georef", requireAuth, dataMutationRateLimit, validateBody(GeorefBodySchema, "POST /api/user/datasets/:id/georef"), asyncHandler(async (req, res): Promise<void> => {
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

  res.json(validateResponse(PostUserDatasetsIdGeorefResponse, metaJson(updated), "POST /api/user/datasets/:id/georef"));
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
  res.json(validateResponse(GetUserDatasetsIdHyd93FeaturesResponse, row.hyd93FeaturesJson ?? [], "GET /api/user/datasets/:id/hyd93-features"));
}));

// ── DELETE /user/datasets/:id ───────────────────────────────────────────────
router.delete("/user/datasets/:id", requireAuth, dataMutationRateLimit, asyncHandler(async (req, res): Promise<void> => {
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
