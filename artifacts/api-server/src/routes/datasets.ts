import { Router } from "express";
import multer from "multer";
import { getAuth } from "@clerk/express";
import { db, customDatasetsTable } from "@workspace/db";
import {
  GetDatasetsResponse,
  GetDatasetsIdTerrainResponse,
  GetDatasetsIdOverviewResponse,
  PostDatasetsUploadResponse,
} from "@workspace/api-zod";
import {
  PRESET_DATASETS,
  buildTerrainGrid,
  parseXyzCsv,
  gridPoints,
} from "../lib/terrain.js";
import { datasetZonesCache } from "./poe.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

// ── GET /datasets ─────────────────────────────────────────────────────────────
router.get("/datasets", async (_req, res): Promise<void> => {
  const list = PRESET_DATASETS.map((d) => ({
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
    const grid = await buildTerrainGrid(id, resolution);
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
    const grid = await buildTerrainGrid(id, 64);
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

// ── GET /datasets/:id/zones ────────────────────────────────────────────────────
// Returns the most-recent AI classification for this dataset from the in-memory
// cache populated by POST /poe/classify.  404 when not yet classified.
router.get("/datasets/:id/zones", (req, res): void => {
  const { id } = req.params as { id: string };
  const cached = datasetZonesCache.get(id);
  if (cached) {
    res.json(cached);
    return;
  }
  res.status(404).json({ error: "not_found", message: "No cached classification for this dataset" });
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
  const terrain = gridPoints(points, resolution, "upload", datasetName);
  const overview = gridPoints(points, 64, "upload", datasetName);

  // Auto-save to the user's account when authenticated
  let savedDatasetId: string | undefined;
  const auth = getAuth(req);
  const userId = auth?.userId ?? null;
  if (userId) {
    try {
      const [saved] = await db
        .insert(customDatasetsTable)
        .values({
          userId,
          name: datasetName,
          minDepth: terrain.minDepth,
          maxDepth: terrain.maxDepth,
          terrainJson: terrain as unknown as Record<string, unknown>,
          overviewJson: overview as unknown as Record<string, unknown>,
        })
        .returning({ id: customDatasetsTable.id });
      if (saved) savedDatasetId = saved.id;
    } catch {
      // Non-fatal: proceed without saving
    }
  }

  res.json(PostDatasetsUploadResponse.parse({ terrain, overview, savedDatasetId }));
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
  const terrain = gridPoints(points, resolution, "upload", datasetName);
  const overview = gridPoints(points, 64, "upload", datasetName);

  res.json(PostDatasetsUploadResponse.parse({ terrain, overview }));
});

export default router;
