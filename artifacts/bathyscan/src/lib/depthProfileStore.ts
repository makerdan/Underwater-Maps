/**
 * depthProfileStore.ts — anchor + sampled cross-section for the
 * right-click depth profile feature.
 *
 * Flow:
 *   1. User right-clicks terrain → "Start depth profile here"
 *      → setAnchor({ lon, lat, depth })
 *   2. User right-clicks terrain → "End depth profile here"
 *      → sampleProfile(grid, end) walks the terrain grid between the two
 *        points, records depth + (optional) zone slot per sample, and stores
 *        the result. Anchor is cleared on completion.
 *   3. <DepthProfilePanel/> reads `profile` and renders the chart. The user
 *      can dismiss it via clearProfile().
 *
 * Independent of the marker system — nothing here writes to markers,
 * cameraStore, or measureStore.
 */
import { create } from "zustand";
import type { TerrainData } from "@workspace/api-client-react";
import {
  WORLD_SIZE,
  MAX_DEPTH_WORLD,
  lonLatToWorldXZ,
  worldXZToLonLat,
} from "./terrain";
import { haversineDistance } from "./geo";
import {
  SALTWATER_ZONE_TO_SLOT,
  FRESHWATER_ZONE_TO_SLOT,
} from "./zoneMap";

export interface ProfilePoint {
  /** Distance from the start of the transect, in metres. */
  distanceM: number;
  /** Sampled depth, in metres. */
  depthM: number;
  /** Texture slot 0..3, or null when no AI classification is available. */
  slot: number | null;
  /** World-space XZ — convenient for drawing the line in the 3D scene. */
  worldX: number;
  worldZ: number;
  /** Geographic coordinates of this sample, derived via worldXZToLonLat. */
  lon: number;
  lat: number;
}

export interface DepthProfileResult {
  start:  { lon: number; lat: number; depth: number };
  end:    { lon: number; lat: number; depth: number };
  points: ProfilePoint[];
  /** Total transect length, metres. */
  totalDistanceM: number;
  /** Min/max depth across all samples (for axis scaling). */
  minDepthM: number;
  maxDepthM: number;
  at: number;
}

interface DepthProfileStore {
  anchor: { lon: number; lat: number; depth: number } | null;
  profile: DepthProfileResult | null;
  /**
   * Index of the sample currently being hovered (by chart or 3D scene).
   * null when nothing is hovered. Shared between DepthProfilePanel and
   * DepthProfileLine to keep their highlights in sync.
   */
  hoverIndex: number | null;
  setAnchor: (p: { lon: number; lat: number; depth: number }) => void;
  clearAnchor: () => void;
  setProfile: (r: DepthProfileResult) => void;
  clearProfile: () => void;
  setHoverIndex: (i: number | null) => void;
}

export const useDepthProfileStore = create<DepthProfileStore>((set) => ({
  anchor: null,
  profile: null,
  hoverIndex: null,
  setAnchor: (p) => set({ anchor: p, profile: null, hoverIndex: null }),
  clearAnchor: () => set({ anchor: null }),
  setProfile: (r) => set({ profile: r, anchor: null, hoverIndex: null }),
  clearProfile: () => set({ profile: null, hoverIndex: null }),
  setHoverIndex: (i) => set({ hoverIndex: i }),
}));

/** Number of samples taken along the transect. */
const SAMPLE_COUNT = 96;

/**
 * Bilinear depth sample from the terrain grid at fractional grid coords.
 * Mirrors getTerrainSurfaceY but returns depth in metres directly.
 */
function sampleDepthMetres(
  grid: TerrainData,
  worldX: number,
  worldZ: number,
): number {
  const { resolution: N, depths, minDepth } = grid;
  const fracCol = ((worldX + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);
  const fracRow = ((worldZ + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);
  const col0 = Math.max(0, Math.min(N - 2, Math.floor(fracCol)));
  const row0 = Math.max(0, Math.min(N - 2, Math.floor(fracRow)));
  const col1 = col0 + 1;
  const row1 = row0 + 1;
  const tx = fracCol - col0;
  const tz = fracRow - row0;
  const d00 = depths[row0 * N + col0] ?? minDepth;
  const d10 = depths[row0 * N + col1] ?? minDepth;
  const d01 = depths[row1 * N + col0] ?? minDepth;
  const d11 = depths[row1 * N + col1] ?? minDepth;
  return (
    d00 * (1 - tx) * (1 - tz) +
    d10 * tx * (1 - tz) +
    d01 * (1 - tx) * tz +
    d11 * tx * tz
  );
}

/** Nearest-neighbour zone-slot lookup, or null when no zoneMap loaded. */
function sampleSlot(
  grid: TerrainData,
  zoneMap: Uint8Array | null,
  worldX: number,
  worldZ: number,
): number | null {
  if (!zoneMap || zoneMap.length !== grid.resolution * grid.resolution) {
    return null;
  }
  const N = grid.resolution;
  const fracCol = ((worldX + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);
  const fracRow = ((worldZ + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);
  const col = Math.max(0, Math.min(N - 1, Math.round(fracCol)));
  const row = Math.max(0, Math.min(N - 1, Math.round(fracRow)));
  const zoneIdx = zoneMap[row * N + col] ?? 0;
  const table = grid.waterType === "freshwater"
    ? FRESHWATER_ZONE_TO_SLOT
    : SALTWATER_ZONE_TO_SLOT;
  return table[zoneIdx] ?? 0;
}

/**
 * Sample SAMPLE_COUNT points along the great-circle approximation between
 * `start` and `end` (treated as planar in grid space — adequate for the
 * small extents BathyScan deals with).
 */
export function buildProfile(
  grid: TerrainData,
  start: { lon: number; lat: number; depth: number },
  end:   { lon: number; lat: number; depth: number },
  zoneMap: Uint8Array | null,
): DepthProfileResult {
  const a = lonLatToWorldXZ(start.lon, start.lat, grid);
  const b = lonLatToWorldXZ(end.lon,   end.lat,   grid);
  const totalDistanceM = haversineDistance(start, end) * 1000;

  const points: ProfilePoint[] = [];
  let minDepthM = Infinity;
  let maxDepthM = -Infinity;

  const denom = Math.max(1, SAMPLE_COUNT - 1);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / denom;
    const worldX = a.x + (b.x - a.x) * t;
    const worldZ = a.z + (b.z - a.z) * t;
    const depthM = sampleDepthMetres(grid, worldX, worldZ);
    const slot   = sampleSlot(grid, zoneMap, worldX, worldZ);
    const { lon, lat } = worldXZToLonLat(worldX, worldZ, grid);
    if (depthM < minDepthM) minDepthM = depthM;
    if (depthM > maxDepthM) maxDepthM = depthM;
    points.push({
      distanceM: totalDistanceM * t,
      depthM,
      slot,
      worldX,
      worldZ,
      lon,
      lat,
    });
  }

  if (!Number.isFinite(minDepthM)) minDepthM = 0;
  if (!Number.isFinite(maxDepthM)) maxDepthM = 0;

  return {
    start,
    end,
    points,
    totalDistanceM,
    minDepthM,
    maxDepthM,
    at: Date.now(),
  };
}

/**
 * Convert a sampled point's world-Y position based on its measured depth.
 * Exported so the in-scene line component can hover slightly above the
 * terrain surface.
 */
export function depthMetresToWorldY(depthM: number, grid: TerrainData): number {
  const range = (grid.maxDepth - grid.minDepth) || 1;
  const t = Math.max(0, Math.min(1, (depthM - grid.minDepth) / range));
  return -t * MAX_DEPTH_WORLD;
}

// Re-export for components that need to convert world coords back to lon/lat
// without importing terrain directly.
export { worldXZToLonLat };
