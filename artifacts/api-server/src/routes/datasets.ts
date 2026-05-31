import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { db, customDatasetsTable, userSettingsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth.js";
import { createRateLimit } from "../middlewares/rateLimit.js";
import {
  GetDatasetsResponse,
  GetDatasetsIdTerrainResponse,
  GetDatasetsIdOverviewResponse,
  PostDatasetsUploadResponse,
} from "@workspace/api-zod";
import {
  ALL_PRESET_DATASETS,
  buildTerrainGrid,
  parseXyzCsv,
  gridPoints,
  previewDataset,
  previewBboxForDownload,
  buildBboxCsvRows,
} from "../lib/terrain.js";
import { fetchCopernicusDem } from "../lib/copernicusDem.js";
import { datasetZonesCache, readZoneDiskByHash, zoneCacheKey } from "./poe.js";
import { substrateFingerprintForDataset } from "../lib/substrateGrid.js";

const datasetUploadRateLimit = createRateLimit({
  route: "dataset-upload",
  windowMs: 60_000,
  max: 10,
  mode: "ip",
});

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });

/**
 * Translates multer errors (file too large, etc.) into the standard ApiError
 * shape so the client sees a structured 4xx instead of a stack-trace 500.
 */
function multerErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "file_too_large",
        details: `Uploaded file exceeds the ${Math.floor(UPLOAD_MAX_BYTES / (1024 * 1024))} MB limit.`,
      });
      return;
    }
    res.status(400).json({ error: "upload_error", details: err.message });
    return;
  }
  next(err);
}

const router = Router();

/**
 * Look up the caller's "smoothTerrainSpikes" preference. Defaults to true
 * (smoothing on) when unauthenticated, missing, or unset.
 */
async function getSmoothingPreference(req: import("express").Request): Promise<boolean> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) return true;
  try {
    const rows = await db
      .select({ settings: userSettingsTable.settings })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId));
    const settings = rows[0]?.settings as Record<string, unknown> | undefined;
    const value = settings?.["smoothTerrainSpikes"];
    return typeof value === "boolean" ? value : true;
  } catch {
    return true;
  }
}

// ── GET /datasets ─────────────────────────────────────────────────────────────
router.get("/datasets", async (req, res): Promise<void> => {
  const rawWaterType = req.query["waterType"];
  const waterTypeFilter =
    rawWaterType === "freshwater" || rawWaterType === "saltwater"
      ? rawWaterType
      : null;

  const source = waterTypeFilter
    ? ALL_PRESET_DATASETS.filter((d) => d.waterType === waterTypeFilter)
    : ALL_PRESET_DATASETS;

  const list = source.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    waterType: d.waterType,
    minDepth: d.minDepth,
    maxDepth: d.maxDepth,
    centerLon: d.centerLon,
    centerLat: d.centerLat,
    bbox: d.bbox,
    ...(d.hasTopography === true ? { hasTopography: true as const } : {}),
    ...(d.hasEfh === true ? { hasEfh: true as const } : {}),
  }));
  res.json(GetDatasetsResponse.parse(list));
});

// ── GET /datasets/:id/terrain ─────────────────────────────────────────────────
router.get("/datasets/:id/terrain", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  const rawRes = req.query["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;

  try {
    const smoothing = await getSmoothingPreference(req);
    const grid = await buildTerrainGrid(id, resolution, { smoothing });
    if (!grid) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    res.json(GetDatasetsIdTerrainResponse.parse(grid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream fetch failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
});

// ── GET /datasets/:id/preview ─────────────────────────────────────────────────
// Lightweight preflight: returns the resolved dataSource (ncei | gebco |
// synthetic) for a preset dataset without transferring the full depth grid.
// The client uses this to warn users before loading procedurally-generated
// (synthetic) bathymetry.
router.get("/datasets/:id/preview", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");
  try {
    const preview = await previewDataset(id);
    if (!preview) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    res.json(preview);
  } catch (err) {
    // Preflight itself failed (rare — internal probes already catch). Always
    // return a graceful 200 with dataSource=unknown so the client can decide
    // whether to proceed; we do NOT gate on the preset registry here because
    // the registry is currently empty in production and user-saved catalog
    // entries should still get the same fallback shape.
    const meta = ALL_PRESET_DATASETS.find((d) => d.id === id);
    const msg = err instanceof Error ? err.message : "Preflight failed";
    res.json({
      datasetId: id,
      name: meta?.name ?? id,
      bbox: meta?.bbox ?? { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
      dataSource: "unknown" as const,
      syntheticReason: `Could not verify data source: ${msg}`,
    });
  }
});

// ── GET /datasets/:id/overview ────────────────────────────────────────────────
router.get("/datasets/:id/overview", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");

  try {
    const smoothing = await getSmoothingPreference(req);
    const grid = await buildTerrainGrid(id, 64, { smoothing });
    if (!grid) {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }
    res.json(GetDatasetsIdOverviewResponse.parse(grid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream fetch failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
});

// ── GET /datasets/:id/zones?h=<gridHash> ──────────────────────────────────────
// Returns the cached AI classification identified by gridHash (content hash of
// the depth grid). The :id path segment is used only for auth/ownership checks.
//
// Cache is keyed by gridHash, NOT by datasetId, which prevents collisions when
// multiple uploads share the synthetic datasetId "upload".
//
// Auth rules:
//  - Preset dataset IDs → public (no auth required)
//  - UUID-format IDs (user-saved datasets) → require auth + ownership check
//  - Other IDs ("upload", etc.) → require auth (no DB row to verify ownership)
router.get("/datasets/:id/zones", async (req, res): Promise<void> => {
  const { id } = req.params as { id: string };
  const gridHash = (req.query["h"] as string | undefined) ?? "";
  const waterTypeRaw = (req.query["w"] as string | undefined) ?? "";

  // Accept either the legacy 8-char FNV-1a hex (for clients on older bundles
  // mid-rollout) or the new 64-char SHA-256 hex produced by the upgraded
  // client-side `hashGrid`. Both are valid lowercase-hex fingerprints; the
  // server then namespaces by waterType inside `zoneCacheKey`.
  const GRID_HASH_RE = /^([a-f0-9]{8}|[a-f0-9]{64})$/;
  if (!gridHash || !GRID_HASH_RE.test(gridHash)) {
    res.status(400).json({
      error: "invalid_param",
      message: "?h= must be a lowercase hex string (8 or 64 chars)",
    });
    return;
  }
  if (waterTypeRaw !== "saltwater" && waterTypeRaw !== "freshwater") {
    res
      .status(400)
      .json({ error: "invalid_param", message: "?w= must be 'saltwater' or 'freshwater'" });
    return;
  }
  const waterType = waterTypeRaw;

  // --- Auth / ownership gate ---
  const isPreset = ALL_PRESET_DATASETS.some((d) => d.id === id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!isPreset) {
    // Only two non-preset ID shapes are recognised now that the bundled
    // presets have been retired: UUID-format saved uploads, and the
    // placeholder "upload" used for anonymous uploads. Anything else
    // (e.g. legacy preset IDs like `thorne-bay`) returns 404 cleanly so
    // the public /datasets/:id/* surface reflects an empty registry.
    if (!UUID_RE.test(id) && id !== "upload") {
      res.status(404).json({ error: "not_found", details: `Dataset '${id}' not found` });
      return;
    }

    const auth = getAuth(req);
    const callerId = auth?.userId ?? null;

    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", message: "Authentication required" });
      return;
    }

    // For UUID-format dataset IDs, verify ownership against the database.
    if (UUID_RE.test(id)) {
      const rows = await db
        .select({ userId: customDatasetsTable.userId })
        .from(customDatasetsTable)
        .where(and(eq(customDatasetsTable.id, id), eq(customDatasetsTable.userId, callerId)));
      if (rows.length === 0) {
        // Either dataset doesn't exist or belongs to a different user
        res.status(403).json({ error: "forbidden", message: "Access denied" });
        return;
      }
    }
    // For "upload" placeholder ID, auth is sufficient; no DB row exists.
  }

  // --- Cache lookup by sha256(gridHash + "|" + waterType) ---
  // The zone cache only ever stores AI results — heuristic fallbacks are not
  // persisted — so every hit reports `source: "ai"`. We default the field on
  // the response so older cached entries written before the field existed
  const substrateFp = substrateFingerprintForDataset(id);
  // Under the new sha256-namespaced cache scheme there are no "bare gridHash"
  // legacy entries — the hydrate pass unlinks any non-64-char files on
  // startup — so we look up only the namespaced key. Datasets with no
  // substrate coverage collapse to fp "00000000", which still produces a
  // stable namespaced key, so behaviour is unchanged for uploads.
  const namespacedKey = zoneCacheKey(gridHash, waterType, substrateFp);
  const inMemory = datasetZonesCache.get(namespacedKey);
  if (inMemory && inMemory.waterType === waterType) {
    res.json({
      ...inMemory,
      source: inMemory.source ?? "ai",
      substrateFp,
      coarseWidth: inMemory.coarseWidth ?? 32,
      coarseHeight: inMemory.coarseHeight ?? 32,
    });
    return;
  }

  const onDisk = await readZoneDiskByHash(gridHash, waterType, substrateFp);
  if (onDisk && onDisk.waterType === waterType) {
    datasetZonesCache.set(namespacedKey, onDisk);
    res.json({
      ...onDisk,
      source: onDisk.source ?? "ai",
      substrateFp,
      coarseWidth: onDisk.coarseWidth ?? 32,
      coarseHeight: onDisk.coarseHeight ?? 32,
    });
    return;
  }

  res.status(404).json({ error: "not_found", message: "No cached classification for this grid" });
});

// ── GET /terrain/land ─────────────────────────────────────────────────────────
// Returns above-water Copernicus DEM 90 m elevation for a given bounding box.
// Results are cached server-side (memory + disk keyed by sha256 of bbox+size)
// so subsequent requests for the same region are served without an upstream
// round-trip. Falls back to a flat-plane (all-zero) grid on upstream failure.
//
// Query params:
//   bbox — comma-separated "minLon,minLat,maxLon,maxLat"
//   size — integer grid resolution, clamped to [32, 256] (default 128)
//
// No auth required — land elevation data is public.
router.get("/terrain/land", async (req, res): Promise<void> => {
  const rawBbox = String(req.query["bbox"] ?? "");
  const rawSize = req.query["size"];

  const parts = rawBbox.split(",").map((s) => parseFloat(s.trim()));
  if (
    parts.length !== 4 ||
    parts.some((v) => !isFinite(v))
  ) {
    res.status(400).json({
      error: "invalid_param",
      details: 'bbox must be "minLon,minLat,maxLon,maxLat" (four finite numbers)',
    });
    return;
  }

  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];

  if (
    minLon >= maxLon || minLat >= maxLat ||
    minLon < -180 || maxLon > 180 ||
    minLat < -90  || maxLat > 90
  ) {
    res.status(400).json({
      error: "invalid_bbox",
      details: "bbox values out of range or min >= max",
    });
    return;
  }

  const rawSizeNum = rawSize !== undefined ? parseInt(String(rawSize), 10) : 128;
  const gridSize = Math.max(32, Math.min(256, isNaN(rawSizeNum) ? 128 : rawSizeNum));

  try {
    const grid = await fetchCopernicusDem({ minLon, minLat, maxLon, maxLat }, gridSize);
    res.json(grid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Land DEM fetch failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
});

// ── GET /terrain/download/info ────────────────────────────────────────────────
// Lightweight preflight for the Overview Map download tool.  Returns the
// resolved source name, nominal resolution, and waterFraction (fraction of
// the N=32 probe grid that contains water cells, 0–1) for the requested bbox.
// The client derives estimatedPoints = resolution² × waterFraction locally so
// resolution switching is instant without an extra round-trip.
// Auth-required so anonymous users cannot probe our upstream APIs.
//
// Max bbox: 10° × 10°.  Returns 400 for out-of-range params.
router.get("/terrain/download/info", requireAuth, async (req, res): Promise<void> => {
  const north = parseFloat(String(req.query["north"] ?? ""));
  const south = parseFloat(String(req.query["south"] ?? ""));
  const east  = parseFloat(String(req.query["east"] ?? ""));
  const west  = parseFloat(String(req.query["west"] ?? ""));

  if (
    !isFinite(north) || !isFinite(south) || !isFinite(east) || !isFinite(west) ||
    north <= south || east <= west ||
    north > 90 || south < -90 || east > 180 || west < -180
  ) {
    res.status(400).json({ error: "invalid_bbox", details: "Provide valid north, south, east, west query params." });
    return;
  }

  const dLon = east - west;
  const dLat = north - south;
  if (dLon > 10 || dLat > 10) {
    res.status(400).json({
      error: "bbox_too_large",
      details: `Bounding box must be at most 10° × 10° (got ${dLon.toFixed(2)}° × ${dLat.toFixed(2)}°).`,
    });
    return;
  }

  try {
    const info = await previewBboxForDownload({ north, south, east, west });
    res.json(info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Preflight failed";
    res.status(502).json({ error: "upstream_error", details: msg });
  }
});

// ── GET /terrain/download ─────────────────────────────────────────────────────
// Builds the full bathymetric grid for the requested bbox and resolution, then
// streams it as a `text/csv` attachment.  Authenticated only — anonymous users
// get a 401 from requireAuth.
//
// Query params: north, south, east, west (degrees), resolution (64|256|512).
// Max bbox: 10° × 10°.
// Only water cells (depth > 0) are emitted; land/topography is excluded.
router.get("/terrain/download", requireAuth, async (req, res): Promise<void> => {
  const north = parseFloat(String(req.query["north"] ?? ""));
  const south = parseFloat(String(req.query["south"] ?? ""));
  const east  = parseFloat(String(req.query["east"] ?? ""));
  const west  = parseFloat(String(req.query["west"] ?? ""));
  const rawRes = parseInt(String(req.query["resolution"] ?? "256"), 10);

  if (
    !isFinite(north) || !isFinite(south) || !isFinite(east) || !isFinite(west) ||
    north <= south || east <= west ||
    north > 90 || south < -90 || east > 180 || west < -180
  ) {
    res.status(400).json({ error: "invalid_bbox", details: "Provide valid north, south, east, west query params." });
    return;
  }

  const dLon = east - west;
  const dLat = north - south;
  if (dLon > 10 || dLat > 10) {
    res.status(400).json({
      error: "bbox_too_large",
      details: `Bounding box must be at most 10° × 10° (got ${dLon.toFixed(2)}° × ${dLat.toFixed(2)}°).`,
    });
    return;
  }

  const resolution = [64, 256, 512].includes(rawRes) ? rawRes : 256;
  const centerLat = (north + south) / 2;
  const centerLon = (east + west) / 2;

  // Derive filename: bathyscan_<lat>N_<lon>W_<res>.csv
  const latAbs = Math.abs(centerLat).toFixed(1);
  const lonAbs = Math.abs(centerLon).toFixed(1);
  const latDir = centerLat >= 0 ? "N" : "S";
  const lonDir = centerLon >= 0 ? "E" : "W";
  const filename = `bathyscan_${latAbs}${latDir}_${lonAbs}${lonDir}_${resolution}.csv`;

  try {
    const rows = await buildBboxCsvRows({ north, south, east, west }, resolution);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    // Stream the CSV: header + data rows.
    res.write("lon,lat,depth\n");
    for (const row of rows) {
      res.write(`${row.lon.toFixed(7)},${row.lat.toFixed(7)},${row.depth.toFixed(3)}\n`);
    }
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Download failed";
    // Only send error header if not already started
    if (!res.headersSent) {
      res.status(502).json({ error: "upstream_error", details: msg });
    } else {
      res.end();
    }
  }
});

// ── POST /datasets/upload (multipart/form-data via multer) ───────────────────
//
// Auth-required. Every successful upload is persisted into the caller's
// dataset library (`custom_datasets`) and the new row's UUID is returned as
// `savedDatasetId`. The viewer loads the uploaded terrain by hitting the
// unified per-user read path (/user/datasets/:id/{terrain,overview}) — there
// is no longer an anonymous "upload" placeholder dataset id.
router.post(
  "/datasets/upload",
  datasetUploadRateLimit,
  requireAuth,
  upload.single("file"),
  multerErrorHandler,
  async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "missing_file", details: "No file uploaded. Send the XYZ/CSV as the 'file' field in a multipart/form-data request." });
    return;
  }

  const fileContent = file.buffer.toString("utf8");
  const fileName = file.originalname;

  // Validate numeric body params via Zod so malformed values surface as a
  // clear 400 instead of falling through `parseInt` → `NaN` and producing a
  // 5xx from a downstream grid call.
  const UploadParamsSchema = z.object({
    resolution: z.coerce.number().int().min(32).max(512).default(256),
    gridResolution: z.coerce.number().int().min(32).max(512).optional(),
  });
  const paramsParsed = UploadParamsSchema.safeParse({
    resolution: req.body["resolution"] ?? req.body["gridResolution"],
    gridResolution: req.body["gridResolution"],
  });
  if (!paramsParsed.success) {
    res.status(400).json({
      error: "invalid_param",
      details: paramsParsed.error.issues
        .map((i) => `${i.path.join(".") || "param"}: ${i.message}`)
        .join("; "),
    });
    return;
  }
  const resolution = paramsParsed.data.gridResolution ?? paramsParsed.data.resolution;

  let points;
  try {
    points = parseXyzCsv(fileContent, fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse error";
    res.status(400).json({ error: "parse_error", details: msg });
    return;
  }

  if (points.length < 10) {
    res.status(400).json({
      error: "insufficient_data",
      details: "File must contain at least 10 valid (lon, lat, depth) rows",
    });
    return;
  }

  const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  const smoothing = await getSmoothingPreference(req);

  // Auth-gated: requireAuth above guarantees a clerkUserId is present.
  const effectiveUserId = (req as AuthenticatedRequest).clerkUserId;
  const gridId = crypto.randomUUID();

  const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });
  const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

  let savedDatasetId: string | undefined;
  let savedDatasetMeta:
    | { id: string; name: string; minDepth: number; maxDepth: number; createdAt: string }
    | undefined;
  let saveError: string | undefined;

  try {
    const [saved] = await db
      .insert(customDatasetsTable)
      .values({
        id: gridId,
        userId: effectiveUserId,
        name: datasetName,
        minDepth: terrain.minDepth,
        maxDepth: terrain.maxDepth,
        terrainJson: terrain as unknown as Record<string, unknown>,
        overviewJson: overview as unknown as Record<string, unknown>,
      })
      .returning({
        id: customDatasetsTable.id,
        name: customDatasetsTable.name,
        minDepth: customDatasetsTable.minDepth,
        maxDepth: customDatasetsTable.maxDepth,
        createdAt: customDatasetsTable.createdAt,
      });
    if (saved) {
      savedDatasetId = saved.id;
      savedDatasetMeta = {
        id: saved.id,
        name: saved.name,
        minDepth: saved.minDepth,
        maxDepth: saved.maxDepth,
        createdAt: saved.createdAt.toISOString(),
      };
    } else {
      saveError = "Database insert returned no row";
      console.warn(
        `[datasets/upload] authenticated upload returned without savedDatasetId (userId=${effectiveUserId}, name=${datasetName})`,
      );
    }
  } catch (err) {
    saveError = err instanceof Error ? err.message : "Failed to save upload to account";
    console.error(
      `[datasets/upload] failed to persist authenticated upload (userId=${effectiveUserId}, name=${datasetName}):`,
      err,
    );
  }

  res.json(
    PostDatasetsUploadResponse.parse({
      terrain,
      overview,
      savedDatasetId,
      savedDatasetMeta,
      saveError,
    }),
  );
});

export default router;
