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
 * A notable feature surfaced by detectProfileFeatures — peaks (humps),
 * troughs (holes) and ledges (sharp slope changes). The UI uses these to
 * suggest auto-markers along the transect.
 */
export type ProfileFeatureKind = "peak" | "trough" | "ledge";

export interface ProfileFeature {
  /** Index into profile.points. */
  index: number;
  kind: ProfileFeatureKind;
  /**
   * For peak/trough: vertical prominence (metres) against the nearest
   * higher/lower neighbour inside the analysis window.
   * For ledge: absolute slope change (metres-per-metre) at that point.
   */
  magnitude: number;
}

/**
 * Find notable peaks, troughs and ledges along the profile.
 *
 * - **peak**: shallowest sample (smallest depth) in a window with prominence
 *   ≥ max(0.5 m, 8% of profile depth range).
 * - **trough**: deepest sample in the same kind of window with the matching
 *   prominence threshold.
 * - **ledge**: large change in vertical slope between adjacent samples, away
 *   from any already-claimed peak/trough.
 *
 * Pure: no store reads, deterministic for a given DepthProfileResult.
 */
export function detectProfileFeatures(
  profile: DepthProfileResult,
): ProfileFeature[] {
  const pts = profile.points;
  const n = pts.length;
  if (n < 5) return [];

  const range = Math.max(1e-3, profile.maxDepthM - profile.minDepthM);
  const minProminence = Math.max(0.5, range * 0.08);
  const windowFrac = 0.05;
  const w = Math.max(2, Math.floor(n * windowFrac));

  const features: ProfileFeature[] = [];

  // Local extrema with prominence — skip the two endpoints, which aren't
  // intrinsically interesting (they're where the user clicked). We require
  // strict inequality against the immediate neighbours so that a flat
  // plateau doesn't have every sample registered as the same extremum;
  // the ledge detector will catch the boundary instead.
  for (let i = 1; i < n - 1; i++) {
    const d = pts[i]!.depthM;
    const dPrev = pts[i - 1]!.depthM;
    const dNext = pts[i + 1]!.depthM;
    const isStrictMin = dPrev > d + 1e-6 && dNext > d + 1e-6;
    const isStrictMax = dPrev < d - 1e-6 && dNext < d - 1e-6;
    if (!isStrictMin && !isStrictMax) continue;
    const lo = Math.max(0, i - w);
    const hi = Math.min(n - 1, i + w);
    let maxNeighbor = -Infinity;
    let minNeighbor = Infinity;
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      const dj = pts[j]!.depthM;
      if (dj > maxNeighbor) maxNeighbor = dj;
      if (dj < minNeighbor) minNeighbor = dj;
    }
    if (isStrictMin && maxNeighbor - d >= minProminence) {
      features.push({ index: i, kind: "peak", magnitude: maxNeighbor - d });
    } else if (isStrictMax && d - minNeighbor >= minProminence) {
      features.push({ index: i, kind: "trough", magnitude: d - minNeighbor });
    }
  }

  // Ledges — large slope changes (drop-offs, shelves) away from existing
  // peaks/troughs.
  const slopes: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.distanceM - pts[i]!.distanceM;
    const dy = pts[i + 1]!.depthM - pts[i]!.depthM;
    slopes[i] = dx > 1e-6 ? dy / dx : 0;
  }
  // Threshold scales with depth range vs transect length so it adapts to
  // both tiny lake transects and ocean-scale ones.
  const meanAbsSlope =
    profile.totalDistanceM > 0 ? range / profile.totalDistanceM : 0;
  const slopeThresh = Math.max(0.02, meanAbsSlope * 3);

  for (let i = w; i < n - 1 - w; i++) {
    const s1 = slopes[i - 1] ?? 0;
    const s2 = slopes[i] ?? 0;
    const delta = Math.abs(s2 - s1);
    if (delta < slopeThresh) continue;
    let near = false;
    for (const f of features) {
      if (Math.abs(f.index - i) < w) {
        near = true;
        break;
      }
    }
    if (near) continue;
    features.push({ index: i, kind: "ledge", magnitude: delta });
  }

  features.sort((a, b) => a.index - b.index);
  return features;
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
