import { Router } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable, userSettingsTable } from "@workspace/db";
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
} from "../lib/terrain.js";
import { datasetZonesCache, readZoneDiskByHash } from "./poe.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

  const GRID_HASH_RE = /^[a-f0-9]{8}$/;
  if (!gridHash || !GRID_HASH_RE.test(gridHash)) {
    res.status(400).json({ error: "invalid_param", message: "?h= must be an 8-char lowercase hex string" });
    return;
  }

  // --- Auth / ownership gate ---
  const isPreset = ALL_PRESET_DATASETS.some((d) => d.id === id);
  if (!isPreset) {
    const auth = getAuth(req);
    const callerId = auth?.userId ?? null;

    if (!callerId) {
      res.status(401).json({ error: "unauthenticated", message: "Authentication required" });
      return;
    }

    // For UUID-format dataset IDs, verify ownership against the database.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // For non-UUID, non-preset IDs (e.g. "upload") auth is sufficient; no DB row exists.
  }

  // --- Cache lookup by gridHash ---
  const inMemory = datasetZonesCache.get(gridHash);
  if (inMemory) {
    res.json(inMemory);
    return;
  }

  const onDisk = await readZoneDiskByHash(gridHash);
  if (onDisk) {
    datasetZonesCache.set(gridHash, onDisk);
    res.json(onDisk);
    return;
  }

  res.status(404).json({ error: "not_found", message: "No cached classification for this grid" });
});

// ── POST /datasets/upload (multipart/form-data via multer) ───────────────────
router.post("/datasets/upload", upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "missing_file", details: "No file uploaded. Send the XYZ/CSV as the 'file' field in a multipart/form-data request." });
    return;
  }

  const fileContent = file.buffer.toString("utf8");
  const fileName = file.originalname;
  const rawRes = req.body["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;

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

  // Auto-save to the user's account when authenticated. We generate the row
  // UUID client-side so that the stored grids carry the real datasetId from
  // the start (instead of the legacy "upload" placeholder).
  let savedDatasetId: string | undefined;
  let savedDatasetMeta:
    | { id: string; name: string; minDepth: number; maxDepth: number; createdAt: string }
    | undefined;
  let saveError: string | undefined;

  const auth = getAuth(req);
  const userId = auth?.userId ?? null;
  const isE2EBypass =
    process.env["E2E_AUTH_BYPASS"] === "1" &&
    typeof req.headers["x-e2e-user-id"] === "string" &&
    (req.headers["x-e2e-user-id"] as string).trim() !== "";
  const effectiveUserId = userId ?? (isE2EBypass ? (req.headers["x-e2e-user-id"] as string).trim() : null);
  const gridId = effectiveUserId ? crypto.randomUUID() : "upload";

  const terrain = gridPoints(points, resolution, gridId, datasetName, { smoothing });
  const overview = gridPoints(points, 64, gridId, datasetName, { smoothing });

  if (effectiveUserId) {
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

// Backward-compat alias: same multipart handling
router.post("/upload", upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "missing_file", details: "No file uploaded. Send the XYZ/CSV as the 'file' field in a multipart/form-data request." });
    return;
  }

  const fileContent = file.buffer.toString("utf8");
  const fileName = file.originalname;
  const rawRes = req.body["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;

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
  const terrain = gridPoints(points, resolution, "upload", datasetName, { smoothing });
  const overview = gridPoints(points, 64, "upload", datasetName, { smoothing });

  res.json(PostDatasetsUploadResponse.parse({ terrain, overview }));
});

export default router;
