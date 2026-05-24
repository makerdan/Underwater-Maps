import { Router } from "express";
import {
  GetDatasetsResponse,
  GetDatasetsIdTerrainResponse,
  GetDatasetsIdOverviewResponse,
  PostDatasetsUploadBody,
  PostDatasetsUploadResponse,
} from "@workspace/api-zod";
import {
  PRESET_DATASETS,
  buildTerrainGrid,
  parseXyzCsv,
  gridPoints,
} from "../lib/terrain.js";

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
      res.status(404).json({ error: "not_found", message: `Dataset '${id}' not found` });
      return;
    }
    res.json(GetDatasetsIdTerrainResponse.parse(grid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream fetch failed";
    res.status(502).json({ error: "upstream_error", message: msg });
  }
});

// ── GET /datasets/:id/overview ────────────────────────────────────────────────
router.get("/datasets/:id/overview", async (req, res): Promise<void> => {
  const id = String(req.params["id"] ?? "");

  try {
    const grid = await buildTerrainGrid(id, 64);
    if (!grid) {
      res.status(404).json({ error: "not_found", message: `Dataset '${id}' not found` });
      return;
    }
    res.json(GetDatasetsIdOverviewResponse.parse(grid));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upstream fetch failed";
    res.status(502).json({ error: "upstream_error", message: msg });
  }
});

// ── POST /datasets/upload ─────────────────────────────────────────────────────
router.post("/datasets/upload", async (req, res): Promise<void> => {
  const parsed = PostDatasetsUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: parsed.error.message });
    return;
  }

  const { fileContent, fileName, resolution = 256 } = parsed.data;

  let points;
  try {
    points = parseXyzCsv(fileContent, fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse error";
    res.status(400).json({ error: "parse_error", message: msg });
    return;
  }

  if (points.length < 10) {
    res.status(400).json({
      error: "insufficient_data",
      message: "File must contain at least 10 valid (lon, lat, depth) rows",
    });
    return;
  }

  const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  const terrain = gridPoints(points, resolution, "upload", datasetName);
  const overview = gridPoints(points, 64, "upload", datasetName);

  res.json(PostDatasetsUploadResponse.parse({ terrain, overview }));
});

// Backward-compat alias kept for existing frontend during transition
router.post("/upload", async (req, res): Promise<void> => {
  const parsed = PostDatasetsUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: parsed.error.message });
    return;
  }

  const { fileContent, fileName, resolution = 256 } = parsed.data;

  let points;
  try {
    points = parseXyzCsv(fileContent, fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse error";
    res.status(400).json({ error: "parse_error", message: msg });
    return;
  }

  if (points.length < 10) {
    res.status(400).json({
      error: "insufficient_data",
      message: "File must contain at least 10 valid (lon, lat, depth) rows",
    });
    return;
  }

  const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  const terrain = gridPoints(points, resolution, "upload", datasetName);

  res.json(GetDatasetsIdTerrainResponse.parse(terrain));
});

export default router;
