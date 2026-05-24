import { Router } from "express";
import {
  ListDatasetsResponse,
  GetDatasetTerrainResponse,
  UploadTerrainBody,
  UploadTerrainResponse,
} from "@workspace/api-zod";
import {
  PRESET_DATASETS,
  buildTerrainGrid,
  parseXyzCsv,
  gridPoints,
} from "../lib/terrain.js";

const router = Router();

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
  res.json(ListDatasetsResponse.parse(list));
});

router.get("/datasets/:id/terrain", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = rawId ?? "";

  const rawRes = req.query["resolution"];
  const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 128;

  const grid = buildTerrainGrid(id, resolution);
  if (!grid) {
    res.status(404).json({ error: "not_found", message: `Dataset '${id}' not found` });
    return;
  }

  res.json(GetDatasetTerrainResponse.parse(grid));
});

router.post("/datasets/upload", async (req, res): Promise<void> => {
  const parsed = UploadTerrainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: parsed.error.message });
    return;
  }

  const { fileContent, fileName, resolution = 128 } = parsed.data;

  let points;
  try {
    points = parseXyzCsv(fileContent, fileName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse error";
    res.status(400).json({ error: "parse_error", message: msg });
    return;
  }

  if (points.length < 4) {
    res.status(400).json({
      error: "insufficient_data",
      message: "File must contain at least 4 valid (lon, lat, depth) rows",
    });
    return;
  }

  const datasetName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  const grid = gridPoints(points, resolution, "upload", datasetName);

  res.json(UploadTerrainResponse.parse(grid));
});

export default router;
