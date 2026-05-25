/**
 * /substrate/:id — terrain-derived seafloor substrate estimates.
 *
 * Computes substrate classification (bedrock / gravel / sand / mud) for each
 * grid cell from the terrain's slope and depth, following CMECS (Coastal and
 * Marine Ecological Classification Standard) broad categories:
 *
 *   bedrock  — slope > 30°, hard substrate
 *   gravel   — slope 12–30° or steep-ish shallow area
 *   sand     — slope < 12°, depth 0–80 m
 *   mud      — slope < 12°, depth > 80 m
 *
 * Returns a GeoJSON FeatureCollection of grid-cell polygons with a `substrate`
 * property. Cells are 1/8 the terrain resolution to keep the response small.
 *
 * Credit: Substrate classification methodology following CMECS / NOAA standards.
 * Real substrate data: Alaska ShoreZone GIS (intertidal) and NCEI Smooth Sheets
 * (subtidal) — https://alaskafisheries.noaa.gov/shorezone/
 */

import { Router } from "express";
import { ALL_PRESET_DATASETS, buildTerrainGrid } from "../lib/terrain.js";

const router = Router();

type SubstrateClass = "bedrock" | "gravel" | "sand" | "mud";

interface SubstrateFeature {
  type: "Feature";
  properties: {
    substrate: SubstrateClass;
    slopeAngleDeg: number;
    depthM: number;
    /** CMECS substrate code */
    cmecsCode: string;
    color: string;
  };
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

const SUBSTRATE_COLORS: Record<SubstrateClass, string> = {
  bedrock: "#6b6b6b",
  gravel: "#b0956a",
  sand:   "#e2d5a0",
  mud:    "#8b7355",
};

const CMECS_CODES: Record<SubstrateClass, string> = {
  bedrock: "2.1.1 Consolidated Mineral Substrate",
  gravel:  "2.2.1 Mixed Coarse Unconsolidated Substrate",
  sand:    "2.2.2 Sand",
  mud:     "2.2.4 Fine Unconsolidated Substrate",
};

function classifySubstrate(slopeDeg: number, depthM: number): SubstrateClass {
  if (slopeDeg > 30) return "bedrock";
  if (slopeDeg > 12 || (slopeDeg > 6 && depthM < 40)) return "gravel";
  if (depthM <= 80) return "sand";
  return "mud";
}

/**
 * Compute slope in degrees at each cell using central differences.
 * Grid is row-major, top-to-bottom, left-to-right.
 * Returns Float32Array of length N×N.
 */
function computeSlopes(depths: number[], N: number, lonSpanDeg: number, latSpanDeg: number): Float32Array {
  const slopes = new Float32Array(N * N);
  const mPerDegLat = 111_320;
  const centerLat = 55.69; // approximate for SE Alaska
  const mPerDegLon = mPerDegLat * Math.cos((centerLat * Math.PI) / 180);

  const dxM = (lonSpanDeg / (N - 1)) * mPerDegLon;
  const dyM = (latSpanDeg / (N - 1)) * mPerDegLat;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(N - 1, row + 1);
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(N - 1, col + 1);

      const dh = (col === 0 || col === N - 1 ? 1 : 2) * dxM;
      const dv = (row === 0 || row === N - 1 ? 1 : 2) * dyM;

      const dzX = (depths[row * N + c1]! - depths[row * N + c0]!) / dh;
      const dzY = (depths[r1 * N + col]! - depths[r0 * N + col]!) / dv;

      slopes[row * N + col] = Math.atan(Math.sqrt(dzX * dzX + dzY * dzY)) * (180 / Math.PI);
    }
  }
  return slopes;
}

/**
 * GET /substrate/:id
 *
 * Returns a GeoJSON FeatureCollection with substrate polygon for each
 * sub-sampled grid cell. Sub-samples the terrain at 1/8 resolution to
 * keep the response under ~500 features.
 */
router.get("/substrate/:id", async (req, res) => {
  const datasetId = req.params["id"]!;
  const meta = ALL_PRESET_DATASETS.find((d) => d.id === datasetId);
  if (!meta) {
    res.status(404).json({ error: "not_found", details: `Dataset '${datasetId}' not found` });
    return;
  }

  const grid = await buildTerrainGrid(datasetId, 64);
  if (!grid) {
    res.status(404).json({ error: "not_found", details: `No terrain data for '${datasetId}'` });
    return;
  }

  const { depths, resolution: N, minLon, maxLon, minLat, maxLat } = grid;
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  const cellW = lonSpan / N;
  const cellH = latSpan / N;

  const slopes = computeSlopes(depths, N, lonSpan, latSpan);

  const features: SubstrateFeature[] = [];

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const idx = row * N + col;
      const depthM = depths[idx] ?? 0;
      const slopeDeg = slopes[idx] ?? 0;
      const substrate = classifySubstrate(slopeDeg, depthM);

      // Cell corners in lon/lat
      const west  = minLon + col * cellW;
      const east  = west + cellW;
      const south = minLat + row * cellH;
      const north = south + cellH;

      features.push({
        type: "Feature",
        properties: {
          substrate,
          slopeAngleDeg: Math.round(slopeDeg * 10) / 10,
          depthM: Math.round(depthM),
          cmecsCode: CMECS_CODES[substrate],
          color: SUBSTRATE_COLORS[substrate],
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [west,  south],
            [east,  south],
            [east,  north],
            [west,  north],
            [west,  south],
          ]],
        },
      });
    }
  }

  res.json({
    type: "FeatureCollection",
    features,
    metadata: {
      datasetId,
      resolution: N,
      totalFeatures: features.length,
      methodology: "Terrain-slope + depth derived substrate (CMECS categories). " +
        "For surveyed areas, real substrate data is from Alaska ShoreZone GIS " +
        "(https://alaskafisheries.noaa.gov/shorezone/) and NCEI Smooth Sheets.",
      credit: "NOAA / CMECS substrate classification standard",
    },
  });
});

export default router;
