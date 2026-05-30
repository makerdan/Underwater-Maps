/**
 * depthProfileStore.ts — anchor + sampled cross-section for the
 * right-click depth profile feature.
 *
 * Flow (straight-line mode):
 *   1. User right-clicks → "Start depth profile here" → setAnchor(p)
 *   2. User right-clicks → "End depth profile here"
 *      → buildProfile() + pushProfile()
 *
 * Flow (path mode):
 *   1. User right-clicks → "Start path profile here" → startPathProfile(p)
 *   2. User right-clicks → "Add waypoint here" → addWaypoint(p)  (repeat)
 *   3. User right-clicks → "Finish path here" (or presses Enter)
 *      → buildPathProfile() + pushProfile()
 *
 * History tabs let the user revisit any of the last 5 profiles.
 * Dismiss everything via clearProfile(). Cancel in-progress via cancelPath().
 *
 * Independent of the marker system.
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
  /**
   * All waypoints for path profiles (start + intermediates + end).
   * Undefined = simple straight two-point transect.
   */
  waypoints?: Array<{ lon: number; lat: number; depth: number }>;
  /** 'line' = two-point transect; 'path' = multi-waypoint route */
  mode?: "line" | "path";
  points: ProfilePoint[];
  /** Total transect length, metres. */
  totalDistanceM: number;
  /** Min/max depth across all samples (for axis scaling). */
  minDepthM: number;
  maxDepthM: number;
  at: number;
}

/** Maximum number of profiles kept in the session history. */
const MAX_HISTORY = 5;

interface DepthProfileStore {
  // ── straight-line mode ──────────────────────────────────────────────────
  anchor: { lon: number; lat: number; depth: number } | null;
  setAnchor: (p: { lon: number; lat: number; depth: number }) => void;
  clearAnchor: () => void;

  // ── path mode ───────────────────────────────────────────────────────────
  /** 'line' = waiting for an end-point; 'path' = collecting waypoints */
  profileMode: "line" | "path";
  /** Ordered waypoints accumulated in path mode (first = start). */
  pathWaypoints: Array<{ lon: number; lat: number; depth: number }>;
  /** Enter path mode and set the first waypoint. */
  startPathProfile: (p: { lon: number; lat: number; depth: number }) => void;
  /** Append a waypoint to the in-progress path. */
  addWaypoint: (p: { lon: number; lat: number; depth: number }) => void;
  /** Abort path mode without generating a profile. */
  cancelPath: () => void;

  // ── history / display ───────────────────────────────────────────────────
  /**
   * History of profiles captured this session, newest first.
   * Length is at most MAX_HISTORY (5).
   */
  profiles: DepthProfileResult[];
  /**
   * Index into `profiles` currently shown in the panel.
   * 0 = most recent. -1 when the panel is hidden.
   */
  selectedIndex: number;
  /**
   * The profile currently shown in the panel: profiles[selectedIndex] ?? null.
   */
  profile: DepthProfileResult | null;
  /**
   * Index of the sample currently being hovered (chart or 3D scene).
   * null when nothing is hovered.
   */
  hoverIndex: number | null;
  pushProfile: (r: DepthProfileResult) => void;
  /** @deprecated Alias for pushProfile — kept for legacy callers. */
  setProfile: (r: DepthProfileResult) => void;
  clearProfile: () => void;
  selectProfile: (index: number) => void;
  setHoverIndex: (i: number | null) => void;
}

export const useDepthProfileStore = create<DepthProfileStore>((set) => ({
  anchor: null,
  profileMode: "line",
  pathWaypoints: [],
  profiles: [],
  selectedIndex: 0,
  profile: null,
  hoverIndex: null,

  setAnchor: (p) =>
    set({
      anchor: p,
      profileMode: "line",
      pathWaypoints: [],
      profile: null,
      hoverIndex: null,
    }),

  clearAnchor: () =>
    set((s) => ({
      anchor: null,
      profileMode: "line",
      pathWaypoints: [],
      profile: s.profiles[s.selectedIndex] ?? null,
    })),

  startPathProfile: (p) =>
    set({
      profileMode: "path",
      pathWaypoints: [p],
      anchor: null,
      profile: null,
      hoverIndex: null,
    }),

  addWaypoint: (p) =>
    set((s) => ({
      pathWaypoints: [...s.pathWaypoints, p],
    })),

  cancelPath: () =>
    set((s) => ({
      profileMode: "line",
      pathWaypoints: [],
      anchor: null,
      profile: s.profiles[s.selectedIndex] ?? null,
    })),

  pushProfile: (r) =>
    set((s) => {
      const profiles = [r, ...s.profiles].slice(0, MAX_HISTORY);
      return {
        profiles,
        selectedIndex: 0,
        profile: r,
        anchor: null,
        profileMode: "line",
        pathWaypoints: [],
        hoverIndex: null,
      };
    }),

  setProfile: (r) =>
    set((s) => {
      const profiles = [r, ...s.profiles].slice(0, MAX_HISTORY);
      return {
        profiles,
        selectedIndex: 0,
        profile: r,
        anchor: null,
        profileMode: "line",
        pathWaypoints: [],
        hoverIndex: null,
      };
    }),

  clearProfile: () =>
    set({
      profiles: [],
      selectedIndex: 0,
      profile: null,
      hoverIndex: null,
      anchor: null,
      profileMode: "line",
      pathWaypoints: [],
    }),

  selectProfile: (index) =>
    set((s) => {
      const clamped = Math.max(0, Math.min(s.profiles.length - 1, index));
      const p = s.profiles[clamped] ?? null;
      return { selectedIndex: clamped, profile: p, hoverIndex: null };
    }),

  setHoverIndex: (i) => set({ hoverIndex: i }),
}));

// ── Sampling helpers ──────────────────────────────────────────────────────

/** Number of samples taken along a transect. */
const SAMPLE_COUNT = 96;

/**
 * Bilinear depth sample from the terrain grid at world XZ.
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
 * Sample SAMPLE_COUNT points along the straight line between `start` and
 * `end` (the original two-point transect).
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
    mode: "line",
    points,
    totalDistanceM,
    minDepthM,
    maxDepthM,
    at: Date.now(),
  };
}

/**
 * Build a depth profile along a multi-waypoint path.
 *
 * The 96 samples are distributed across segments proportionally to each
 * segment's haversine length, so shorter segments aren't over-sampled and
 * longer ones aren't under-sampled. The distanceM on each point accumulates
 * continuously across all segments, giving a single unbroken X-axis scale.
 *
 * Requires at least two waypoints; callers should guard against this.
 */
export function buildPathProfile(
  grid: TerrainData,
  waypoints: Array<{ lon: number; lat: number; depth: number }>,
  zoneMap: Uint8Array | null,
): DepthProfileResult {
  if (waypoints.length < 2) {
    const wp = waypoints[0] ?? { lon: 0, lat: 0, depth: 0 };
    return buildProfile(grid, wp, wp, zoneMap);
  }

  // Compute per-segment lengths.
  const segLengths: number[] = [];
  let totalDistanceM = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const len = haversineDistance(waypoints[i]!, waypoints[i + 1]!) * 1000;
    segLengths.push(len);
    totalDistanceM += len;
  }

  // Distribute SAMPLE_COUNT samples across segments proportionally.
  // Each segment gets at least 2 samples (start + end). We compute ideal
  // fractional counts, then round, and correct the last segment so the
  // total is exactly SAMPLE_COUNT.
  const segSampleCounts: number[] = [];
  if (totalDistanceM < 1e-6) {
    // Degenerate: all waypoints at the same spot.
    for (let i = 0; i < segLengths.length; i++) {
      segSampleCounts.push(i === 0 ? SAMPLE_COUNT : 0);
    }
  } else {
    let allocated = 0;
    for (let i = 0; i < segLengths.length; i++) {
      const ideal = (segLengths[i]! / totalDistanceM) * SAMPLE_COUNT;
      const count = i < segLengths.length - 1
        ? Math.max(2, Math.round(ideal))
        : Math.max(2, SAMPLE_COUNT - allocated);
      segSampleCounts.push(count);
      allocated += count;
    }
  }

  const points: ProfilePoint[] = [];
  let minDepthM = Infinity;
  let maxDepthM = -Infinity;
  let cumulativeDistanceM = 0;

  for (let seg = 0; seg < waypoints.length - 1; seg++) {
    const wA = waypoints[seg]!;
    const wB = waypoints[seg + 1]!;
    const a = lonLatToWorldXZ(wA.lon, wA.lat, grid);
    const b = lonLatToWorldXZ(wB.lon, wB.lat, grid);
    const segLen = segLengths[seg]!;
    const count = segSampleCounts[seg]!;

    // For segments after the first, skip sample i=0 to avoid duplicating
    // the shared boundary point.
    const startI = seg === 0 ? 0 : 1;
    const denom = Math.max(1, count - 1);

    for (let i = startI; i < count; i++) {
      const t = i / denom;
      const worldX = a.x + (b.x - a.x) * t;
      const worldZ = a.z + (b.z - a.z) * t;
      const depthM = sampleDepthMetres(grid, worldX, worldZ);
      const slot   = sampleSlot(grid, zoneMap, worldX, worldZ);
      const { lon, lat } = worldXZToLonLat(worldX, worldZ, grid);
      const distanceM = cumulativeDistanceM + segLen * t;
      if (depthM < minDepthM) minDepthM = depthM;
      if (depthM > maxDepthM) maxDepthM = depthM;
      points.push({ distanceM, depthM, slot, worldX, worldZ, lon, lat });
    }

    cumulativeDistanceM += segLen;
  }

  if (!Number.isFinite(minDepthM)) minDepthM = 0;
  if (!Number.isFinite(maxDepthM)) maxDepthM = 0;

  return {
    start: waypoints[0]!,
    end: waypoints[waypoints.length - 1]!,
    waypoints: [...waypoints],
    mode: "path",
    points,
    totalDistanceM,
    minDepthM,
    maxDepthM,
    at: Date.now(),
  };
}

// ── Feature detection ─────────────────────────────────────────────────────

/**
 * A notable feature surfaced by detectProfileFeatures — peaks (humps),
 * troughs (holes) and ledges (sharp slope changes).
 */
export type ProfileFeatureKind = "peak" | "trough" | "ledge";

export interface ProfileFeature {
  index: number;
  kind: ProfileFeatureKind;
  magnitude: number;
}

/**
 * Find notable peaks, troughs and ledges along the profile.
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

  const slopes: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1]!.distanceM - pts[i]!.distanceM;
    const dy = pts[i + 1]!.depthM - pts[i]!.depthM;
    slopes[i] = dx > 1e-6 ? dy / dx : 0;
  }
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
 * Convert a depth value to a world-Y coordinate for the in-scene line.
 */
export function depthMetresToWorldY(depthM: number, grid: TerrainData): number {
  const range = (grid.maxDepth - grid.minDepth) || 1;
  const t = Math.max(0, Math.min(1, (depthM - grid.minDepth) / range));
  return -t * MAX_DEPTH_WORLD;
}

export { worldXZToLonLat };
