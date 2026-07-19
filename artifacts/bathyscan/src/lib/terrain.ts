import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { SALTWATER_ZONE_TO_SLOT, FRESHWATER_ZONE_TO_SLOT } from "./zoneMap";

/** Physical size of the terrain mesh in world units (X and Z axes). */
export const WORLD_SIZE = 100;

/** Maximum terrain depth mapped to this many negative world-Y units. */
export const MAX_DEPTH_WORLD = 50;

/**
 * Build a Three.js BufferGeometry from a TerrainData grid.
 *
 * - Uses PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N−1, N−1) so there is one
 *   vertex per depth sample.
 * - Rotates the plane to lie flat in XZ.
 * - Displaces each vertex's Y by  −t × MAX_DEPTH_WORLD  where t is the
 *   normalised depth (depth − minDepth) / (maxDepth − minDepth).
 * - Initialises the colour buffer to a neutral mid-grey placeholder.
 *   All real per-vertex tinting is applied by the useEffect in TerrainMesh.tsx
 *   immediately after mount, so baking colours here would be wasted work.
 * - Recomputes vertex normals for correct lighting.
 */
/** Light-gray colour for no-data (null depth) tiles — cartographically conventional land/gap colour. */
export const NO_DATA_COLOR = { r: 0.75, g: 0.75, b: 0.75 } as const;

export function buildTerrainGeometry(grid: TerrainData): THREE.BufferGeometry {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;

  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes["position"]!.array as Float32Array;
  const colors = new Float32Array(positions.length);

  for (let i = 0; i < depths.length; i++) {
    const depth = depths[i];

    // Null, undefined, or non-finite depth → survey gap: render as flat tile
    // at the water surface (t = 0) using a distinct muted steel-blue colour
    // that the colormap pass will NOT overwrite (see applyColormapToVertexColors).
    if (depth === null || depth === undefined || !Number.isFinite(depth)) {
      positions[i * 3 + 1] = 0;
      colors[i * 3]     = NO_DATA_COLOR.r;
      colors[i * 3 + 1] = NO_DATA_COLOR.g;
      colors[i * 3 + 2] = NO_DATA_COLOR.b;
      continue;
    }

    // Clamp positive (above-water) depths to 0 so land cells sit flat at the
    // waterline instead of displacing upward into tall spikes under exaggeration.
    const clampedDepth = Math.min(depth, 0);
    const t = (clampedDepth - minDepth) / depthRange;
    const clampedT = Math.max(0, Math.min(1, t));

    // After rotateX(-PI/2), index 1 of each vertex triplet is world Y (up/down).
    // Guard against IEEE-754 −0: when clampedT is exactly 0 the product
    // −0 × MAX_DEPTH_WORLD yields −0.0, which stringifies as "−0" in the HUD.
    positions[i * 3 + 1] = clampedT === 0 ? 0 : -clampedT * MAX_DEPTH_WORLD;

    // Neutral mid-grey placeholder — overwritten by the TerrainMesh colour effect.
    colors[i * 3]     = 0.5;
    colors[i * 3 + 1] = 0.5;
    colors[i * 3 + 2] = 0.5;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Solid-bottom "skirt + floor" geometry
// ---------------------------------------------------------------------------

/** Extra world units below the deepest point at which the closing floor sits. */
export const FLOOR_DEPTH_EXTRA = 4;

/** World-Y position of the flat floor plane that closes the bottom geometry. */
export const FLOOR_Y = -MAX_DEPTH_WORLD - FLOOR_DEPTH_EXTRA;

/**
 * Build the closed "skirt + floor" geometry for the given terrain grid.
 *
 * Produces:
 *  - Four side walls along the N/S/E/W terrain edges, each a strip whose top
 *    vertices exactly match the terrain's edge vertices (same X/Z and the same
 *    depth-normalised Y as buildTerrainGeometry) and whose bottom vertices sit
 *    at FLOOR_Y.
 *  - A flat floor plane at FLOOR_Y spanning the full WORLD_SIZE footprint.
 *
 * The wall vertices are duplicated so each wall can carry its own outward
 * normal, and the floor uses a downward normal. The returned BufferGeometry
 * is indexed and ready to render with any standard lit material.
 */
export function buildTerrainSkirtGeometry(grid: TerrainData): THREE.BufferGeometry {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const half = WORLD_SIZE / 2;
  const step = WORLD_SIZE / Math.max(1, N - 1);

  // Null, undefined, or non-finite depth = survey gap → render at surface (y = 0).
  // Guard against IEEE-754 −0: when t is exactly 0 the product −0 × MAX_DEPTH_WORLD
  // yields −0.0, which stringifies as "−0" in the HUD.
  const topY = (depth: number | null | undefined): number => {
    if (depth === null || depth === undefined || !Number.isFinite(depth)) return 0;
    // Clamp positive (above-water) depths to 0 — same rule as buildTerrainGeometry.
    const clampedDepth = Math.min(depth, 0);
    const t = Math.max(0, Math.min(1, (clampedDepth - minDepth) / depthRange));
    return t === 0 ? 0 : -t * MAX_DEPTH_WORLD;
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  type Sample = { x: number; z: number; y: number };

  const addWall = (samples: Sample[], normal: [number, number, number], flipWinding: boolean): void => {
    const base = positions.length / 3;
    for (const s of samples) {
      positions.push(s.x, s.y, s.z);
      normals.push(normal[0], normal[1], normal[2]);
      positions.push(s.x, FLOOR_Y, s.z);
      normals.push(normal[0], normal[1], normal[2]);
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const t0 = base + i * 2;
      const b0 = t0 + 1;
      const t1 = base + (i + 1) * 2;
      const b1 = t1 + 1;
      if (flipWinding) {
        indices.push(t0, t1, b0);
        indices.push(t1, b1, b0);
      } else {
        indices.push(t0, b0, t1);
        indices.push(t1, b0, b1);
      }
    }
  };

  // North edge: row=0 → z=-half, outward normal -Z
  const north: Sample[] = [];
  for (let col = 0; col < N; col++) {
    north.push({
      x: -half + col * step,
      z: -half,
      y: topY(depths[col]),
    });
  }
  addWall(north, [0, 0, -1], true);

  // South edge: row=N-1 → z=+half, outward normal +Z
  const south: Sample[] = [];
  for (let col = 0; col < N; col++) {
    south.push({
      x: -half + col * step,
      z: half,
      y: topY(depths[(N - 1) * N + col]),
    });
  }
  addWall(south, [0, 0, 1], false);

  // West edge: col=0 → x=-half, outward normal -X
  const west: Sample[] = [];
  for (let row = 0; row < N; row++) {
    west.push({
      x: -half,
      z: -half + row * step,
      y: topY(depths[row * N]),
    });
  }
  addWall(west, [-1, 0, 0], false);

  // East edge: col=N-1 → x=+half, outward normal +X
  const east: Sample[] = [];
  for (let row = 0; row < N; row++) {
    east.push({
      x: half,
      z: -half + row * step,
      y: topY(depths[row * N + (N - 1)]),
    });
  }
  addWall(east, [1, 0, 0], true);

  // Flat floor plane at FLOOR_Y, downward normal
  {
    const base = positions.length / 3;
    positions.push(-half, FLOOR_Y, -half); normals.push(0, -1, 0);
    positions.push( half, FLOOR_Y, -half); normals.push(0, -1, 0);
    positions.push( half, FLOOR_Y,  half); normals.push(0, -1, 0);
    positions.push(-half, FLOOR_Y,  half); normals.push(0, -1, 0);
    indices.push(base, base + 2, base + 1);
    indices.push(base, base + 3, base + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// ---------------------------------------------------------------------------
// Zone weight computation for bottom texture system
// ---------------------------------------------------------------------------

/** smoothstep — zero at edge0, one at edge1 (or inverted when edge0 > edge1). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / ((edge1 - edge0) || 1)));
  return t * t * (3 - 2 * t);
}

/**
 * Blend depth-based texture weights with AI zone weights.
 *
 * Both inputs must be Float32Array of length 4 (one weight per texture slot).
 * The result is a new Float32Array of length 4, normalised to sum=1.
 *
 * @param depthWeights — computed from terrain depth/slope
 * @param aiWeights    — derived from AI zone classification (sparse: 1 at dominant slot)
 * @param aiStrength   — blend factor (0 = pure depth, 1 = pure AI). Default: 0.70
 */
export function blendZoneWeights(
  depthWeights: Float32Array,
  aiWeights: Float32Array,
  aiStrength: number,
): Float32Array {
  const result = new Float32Array(4);
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const v = aiStrength * (aiWeights[i] ?? 0) + (1 - aiStrength) * (depthWeights[i] ?? 0);
    result[i] = Math.max(0, v);
    sum += result[i] ?? 0;
  }
  if (sum > 0) {
    for (let i = 0; i < 4; i++) result[i] = (result[i] ?? 0) / sum;
  }
  return result;
}

/**
 * Compute per-vertex zone weights for the four seafloor texture zones:
 *   [0] sand     — shallow/shelf  (t < 0.20)
 *   [1] sediment — mid-slope      (t 0.20–0.55)
 *   [2] silt     — abyssal plain  (t 0.55–0.85)
 *   [3] basalt   — trench/volcanic (t > 0.85, or slope > 35°)
 *
 * Thresholds are relative to each grid's own minDepth/maxDepth so every
 * dataset shows the full texture progression.
 *
 * If `zoneMap` is provided (Uint8Array, one zone index per vertex, same resolution
 * as the terrain grid), AI zone weights are blended 70 % AI + 30 % depth.
 *
 * Returns a Float32Array of length N×N×4 (four weights per vertex).
 */
export function computeZoneWeights(
  grid: TerrainData,
  zoneMap?: Uint8Array,
): Float32Array {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const weights = new Float32Array(N * N * 4);

  const hasZoneMap = !!zoneMap && zoneMap.length === N * N;
  const zoneToSlot = grid.waterType === "freshwater"
    ? FRESHWATER_ZONE_TO_SLOT
    : SALTWATER_ZONE_TO_SLOT;

  const vertStep = WORLD_SIZE / Math.max(1, N - 1); // horizontal world units per grid step
  const SLOPE_THRESHOLD = 35 * (Math.PI / 180);
  const SLOPE_MAX = SLOPE_THRESHOLD * 1.6;

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const idx = row * N + col;

      // Normalised depth [0 = shallow, 1 = deepest].
      // Null cells (survey gaps) are treated as shallowest (t = 0 → sand zone)
      // since their actual depth is unknown; the no-data colour takes precedence
      // over zone weights for these cells anyway.
      const rawDepth = depths[idx];
      const depth = rawDepth === null || rawDepth === undefined ? minDepth : rawDepth;
      const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));

      // Base zone weights via soft overlapping ramps
      let wSand     = 1 - smoothstep(0.12, 0.30, t);
      let wSediment = smoothstep(0.10, 0.28, t) * (1 - smoothstep(0.48, 0.65, t));
      let wSilt     = smoothstep(0.44, 0.60, t) * (1 - smoothstep(0.76, 0.90, t));
      let wBasalt   = smoothstep(0.74, 0.88, t);

      // Slope override: steep faces expose hard basalt regardless of depth
      const tOf = (r: number, c: number): number => {
        const d = depths[r * N + c];
        // Null cells → treat as minDepth (surface) for slope computation
        const dv = d === null || d === undefined ? minDepth : d;
        return (dv - minDepth) / depthRange;
      };
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(N - 1, row + 1);
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(N - 1, col + 1);

      const dtX = (tOf(row, c1) - tOf(row, c0)) * MAX_DEPTH_WORLD;
      const dtZ = (tOf(r1, col) - tOf(r0, col)) * MAX_DEPTH_WORLD;
      const dHoriz = (col === 0 || col === N - 1 ? 1 : 2) * vertStep;
      const dVert  = (row === 0 || row === N - 1 ? 1 : 2) * vertStep;

      const slopeX = Math.abs(dtX / dHoriz);
      const slopeZ = Math.abs(dtZ / dVert);
      const slopeAngle = Math.atan(Math.sqrt(slopeX * slopeX + slopeZ * slopeZ));

      if (slopeAngle > SLOPE_THRESHOLD) {
        const slopeBlend = smoothstep(SLOPE_THRESHOLD, SLOPE_MAX, slopeAngle);
        wBasalt   = Math.max(wBasalt, slopeBlend);
        wSand     *= (1 - slopeBlend);
        wSediment *= (1 - slopeBlend);
        wSilt     *= (1 - slopeBlend);
      }

      // Normalise depth weights
      const sum = wSand + wSediment + wSilt + wBasalt;
      const inv = sum > 0 ? 1 / sum : 1;

      const wi = idx * 4;

      if (hasZoneMap) {
        // Blend 70 % AI + 30 % depth
        const zoneIdx = zoneMap![idx] ?? 0;
        const slot = zoneToSlot[zoneIdx] ?? 0;

        // AI weight: 1.0 at the dominant slot, 0 elsewhere
        const aiW0 = slot === 0 ? 1 : 0;
        const aiW1 = slot === 1 ? 1 : 0;
        const aiW2 = slot === 2 ? 1 : 0;
        const aiW3 = slot === 3 ? 1 : 0;

        // 0.7 * ai + 0.3 * depth — both sum to 1 so result also sums to 1
        let b0 = 0.7 * aiW0 + 0.3 * (wSand     * inv);
        let b1 = 0.7 * aiW1 + 0.3 * (wSediment * inv);
        let b2 = 0.7 * aiW2 + 0.3 * (wSilt     * inv);
        let b3 = 0.7 * aiW3 + 0.3 * (wBasalt   * inv);

        // Renormalise for numerical safety
        const bs = b0 + b1 + b2 + b3;
        const bi = bs > 0 ? 1 / bs : 1;
        weights[wi]     = b0 * bi;
        weights[wi + 1] = b1 * bi;
        weights[wi + 2] = b2 * bi;
        weights[wi + 3] = b3 * bi;
      } else {
        weights[wi]     = wSand     * inv;
        weights[wi + 1] = wSediment * inv;
        weights[wi + 2] = wSilt     * inv;
        weights[wi + 3] = wBasalt   * inv;
      }
    }
  }

  return weights;
}

// ---------------------------------------------------------------------------
// Coordinate mapping utilities
// ---------------------------------------------------------------------------

/**
 * Convert a world-space Y position (negative = deeper) to an estimated depth
 * in metres for the given grid.
 */
export function worldYToMetres(worldY: number, grid: TerrainData): number {
  const t = Math.max(0, Math.min(1, -worldY / MAX_DEPTH_WORLD));
  return grid.minDepth + t * (grid.maxDepth - grid.minDepth);
}

/**
 * Convert world-space XZ coordinates to geographic longitude/latitude.
 * X ∈ [−WORLD_SIZE/2, WORLD_SIZE/2] → [minLon, maxLon]
 * Z ∈ [−WORLD_SIZE/2, WORLD_SIZE/2] → [minLat, maxLat]
 */
export function worldXZToLonLat(
  worldX: number,
  worldZ: number,
  grid: TerrainData,
): { lon: number; lat: number } {
  const lonRange = grid.maxLon - grid.minLon;
  const latRange = grid.maxLat - grid.minLat;
  const lon = grid.minLon + ((worldX + WORLD_SIZE / 2) / WORLD_SIZE) * lonRange;
  const lat = grid.minLat + ((worldZ + WORLD_SIZE / 2) / WORLD_SIZE) * latRange;
  return { lon, lat };
}

// ---------------------------------------------------------------------------
// Slope attribute computation
// ---------------------------------------------------------------------------

/**
 * Compute per-vertex slope in degrees.
 * Uses central finite differences (forward/backward at edges).
 * Returns a Float32Array of length N×N, one slope per vertex.
 */
export function computeSlopeAttribute(grid: TerrainData): Float32Array {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;
  const vertStep = WORLD_SIZE / Math.max(1, N - 1);
  const slopes = new Float32Array(N * N);

  const tOf = (r: number, c: number): number => {
    const d = depths[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))];
    // Null cells (survey gaps) → treat as surface for slope computation
    const dv = d === null || d === undefined ? minDepth : d;
    return (dv - minDepth) / depthRange;
  };

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const r0 = Math.max(0, row - 1);
      const r1 = Math.min(N - 1, row + 1);
      const c0 = Math.max(0, col - 1);
      const c1 = Math.min(N - 1, col + 1);
      const dHoriz = (col === 0 || col === N - 1 ? 1 : 2) * vertStep;
      const dVert  = (row === 0 || row === N - 1 ? 1 : 2) * vertStep;
      const dtX = (tOf(row, c1) - tOf(row, c0)) * MAX_DEPTH_WORLD;
      const dtZ = (tOf(r1, col) - tOf(r0, col)) * MAX_DEPTH_WORLD;
      const slopeX = Math.abs(dtX / dHoriz);
      const slopeZ = Math.abs(dtZ / dVert);
      slopes[row * N + col] = Math.atan(Math.sqrt(slopeX * slopeX + slopeZ * slopeZ)) * (180 / Math.PI);
    }
  }
  return slopes;
}

// ---------------------------------------------------------------------------
// Statistic computation
// ---------------------------------------------------------------------------

export type StatMetric =
  | "mean_depth" | "max_depth" | "min_depth" | "depth_std_dev"
  | "area_km2"   | "slope_mean"
  | "deepest_coordinates" | "shallowest_coordinates";

/**
 * Compute a named statistic over the given terrain grid.
 * Returns a number for scalar metrics or { lon, lat } for coordinate metrics.
 */
export function computeStatistic(
  metric: StatMetric,
  grid: TerrainData,
): number | { lon: number; lat: number } {
  const { depths, minLon, maxLon, minLat, maxLat, resolution: N } = grid;
  const len = depths.length;

  if (metric === "mean_depth") {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += depths[i] ?? 0;
    return sum / len;
  }

  if (metric === "max_depth") {
    let mx = -Infinity;
    for (let i = 0; i < len; i++) { const v = depths[i] ?? 0; if (v > mx) mx = v; }
    return mx;
  }

  if (metric === "min_depth") {
    let mn = Infinity;
    for (let i = 0; i < len; i++) { const v = depths[i] ?? 0; if (v < mn) mn = v; }
    return mn;
  }

  if (metric === "depth_std_dev") {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += depths[i] ?? 0;
    const mean = sum / len;
    let variance = 0;
    for (let i = 0; i < len; i++) variance += ((depths[i] ?? 0) - mean) ** 2;
    return Math.sqrt(variance / len);
  }

  if (metric === "area_km2") {
    const R = 6371;
    const centerLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const dLon = (maxLon - minLon) * (Math.PI / 180);
    const dLat = (maxLat - minLat) * (Math.PI / 180);
    const widthKm  = R * dLon * Math.cos(centerLatRad);
    const heightKm = R * dLat;
    return Math.abs(widthKm * heightKm);
  }

  if (metric === "slope_mean") {
    const slopes = computeSlopeAttribute(grid);
    let sum = 0;
    for (let i = 0; i < slopes.length; i++) sum += slopes[i] ?? 0;
    return sum / slopes.length;
  }

  // Coordinate metrics
  const lonRange = maxLon - minLon;
  const latRange = maxLat - minLat;

  if (metric === "deepest_coordinates") {
    let maxVal = -Infinity; let maxIdx = 0;
    for (let i = 0; i < len; i++) { const v = depths[i] ?? 0; if (v > maxVal) { maxVal = v; maxIdx = i; } }
    const row = Math.floor(maxIdx / N); const col = maxIdx % N;
    return { lon: minLon + (N > 1 ? (col / (N - 1)) : 0) * lonRange, lat: minLat + (N > 1 ? (row / (N - 1)) : 0) * latRange };
  }

  if (metric === "shallowest_coordinates") {
    let minVal = Infinity; let minIdx = 0;
    for (let i = 0; i < len; i++) { const v = depths[i] ?? 0; if (v < minVal) { minVal = v; minIdx = i; } }
    const row = Math.floor(minIdx / N); const col = minIdx % N;
    return { lon: minLon + (N > 1 ? (col / (N - 1)) : 0) * lonRange, lat: minLat + (N > 1 ? (row / (N - 1)) : 0) * latRange };
  }

  return 0;
}

/**
 * Get the world-space Y position of the terrain surface at a given world XZ.
 *
 * Uses bilinear interpolation across the four nearest grid cells.
 * Returns a negative value (deeper = more negative).
 */
export function getTerrainSurfaceY(
  grid: TerrainData,
  worldX: number,
  worldZ: number,
): number {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;

  // Convert world XZ → fractional grid column/row
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

  const depth = d00 * (1 - tx) * (1 - tz)
    + d10 * tx * (1 - tz)
    + d01 * (1 - tx) * tz
    + d11 * tx * tz;

  const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
  return -t * MAX_DEPTH_WORLD;
}

/**
 * Write per-vertex RGB values into a pre-allocated Float32Array using a
 * colormap function. Each vertex occupies 3 consecutive entries (R, G, B).
 *
 * Null depth entries represent survey gaps (no-data cells). Those indices are
 * skipped so the no-data steel-blue colour written by buildTerrainGeometry is
 * preserved — the depth colormap must not overwrite it.
 *
 * Extracted from the TerrainMesh vertex-recolor useEffect so the same logic
 * can be unit-tested without a React or Three.js rendering context. The
 * caller is responsible for setting `colorAttr.needsUpdate = true` after
 * calling this function.
 *
 * @param depths     - depth value per vertex (metres); null = survey gap
 * @param minDepth   - minimum depth in the grid (metres)
 * @param maxDepth   - maximum depth in the grid (metres)
 * @param colors     - Float32Array of length depths.length × 3 (mutated in-place)
 * @param toColor    - colormap function returned by getColormap(); maps t∈[0,1] → {r,g,b}
 */
export function applyColormapToVertexColors(
  depths: ArrayLike<number | null>,
  minDepth: number,
  maxDepth: number,
  colors: Float32Array,
  toColor: (t: number) => { r: number; g: number; b: number },
): void {
  const depthRange = (maxDepth - minDepth) || 1;
  for (let i = 0; i < depths.length; i++) {
    const depth = (depths as (number | null)[])[i];
    // Null, undefined, or non-finite depth = survey gap — preserve the no-data
    // colour already set by buildTerrainGeometry; do not overwrite it with the
    // depth colormap. The non-finite check is belt-and-suspenders for any future
    // data path that skips the server-side NaN → JSON null serialisation.
    if (depth === null || depth === undefined || !Number.isFinite(depth)) continue;
    const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));
    const c = toColor(t);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
}

// ---------------------------------------------------------------------------
// Depth contour snapping utilities
// ---------------------------------------------------------------------------

/**
 * Sample the seafloor depth (in metres) at a world XZ position using bilinear
 * interpolation.  Returns a value in the terrain's [minDepth, maxDepth] range,
 * or `minDepth` when the position is outside the grid.
 */
export function sampleDepthAt(
  grid: TerrainData,
  worldX: number,
  worldZ: number,
): number {
  const { resolution: N, depths, minDepth } = grid;

  const fracCol = ((worldX + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);
  const fracRow = ((worldZ + WORLD_SIZE / 2) / WORLD_SIZE) * (N - 1);

  if (fracCol < 0 || fracCol > N - 1 || fracRow < 0 || fracRow > N - 1) {
    return minDepth;
  }

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

  return d00 * (1 - tx) * (1 - tz)
    + d10 * tx * (1 - tz)
    + d01 * (1 - tx) * tz
    + d11 * tx * tz;
}

/**
 * Find the nearest point on the depth contour `targetDepthM` from a starting
 * world XZ position.
 *
 * Algorithm:
 *  1. Compute the numerical depth gradient at the starting point.
 *  2. Determine which direction along the gradient leads toward the target.
 *  3. Binary-search along that direction to find where depth = targetDepthM.
 *
 * Returns null when the target depth is unreachable within the search radius
 * (e.g. the contour does not exist on this terrain), or when the gradient is
 * too flat to determine a direction.
 *
 * @param maxSearchWorldUnits  Maximum world-unit radius to search (default 20).
 */
export function snapWorldXZToDepthContour(
  grid: TerrainData,
  worldX: number,
  worldZ: number,
  targetDepthM: number,
  maxSearchWorldUnits: number = 20,
): { x: number; z: number } | null {
  const EPS = 0.15; // step size for gradient estimation
  const depthAt = (x: number, z: number) => sampleDepthAt(grid, x, z);

  const d0 = depthAt(worldX, worldZ);
  const dX = depthAt(worldX + EPS, worldZ) - depthAt(worldX - EPS, worldZ);
  const dZ = depthAt(worldX, worldZ + EPS) - depthAt(worldX, worldZ - EPS);
  const gradLen = Math.sqrt(dX * dX + dZ * dZ);

  // If the terrain is perfectly flat here we can't determine a useful direction.
  if (gradLen < 1e-6) return null;

  // Normalised gradient (points toward deeper water).
  const gx = dX / gradLen;
  const gz = dZ / gradLen;

  // Walk toward target depth: if current < target we need deeper (follow +gradient).
  const sign = d0 < targetDepthM ? 1 : -1;
  const ex = worldX + gx * sign * maxSearchWorldUnits;
  const ez = worldZ + gz * sign * maxSearchWorldUnits;

  // Check that the far endpoint is on the other side of the contour.
  const dEnd = depthAt(ex, ez);
  const crossesContour =
    (d0 - targetDepthM) * (dEnd - targetDepthM) <= 0;

  if (!crossesContour) return null;

  // Binary search between (worldX, worldZ) and (ex, ez).
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 32; iter++) {
    const mid = (lo + hi) / 2;
    const mx = worldX + (ex - worldX) * mid;
    const mz = worldZ + (ez - worldZ) * mid;
    const dm = depthAt(mx, mz);
    if ((d0 - targetDepthM) * (dm - targetDepthM) <= 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const t = (lo + hi) / 2;
  return {
    x: worldX + (ex - worldX) * t,
    z: worldZ + (ez - worldZ) * t,
  };
}

/**
 * Trace a segment of the depth contour at `targetDepthM`, starting from
 * `startX/startZ` (which should already lie on or very near the contour).
 *
 * Walks in both directions perpendicular to the gradient, collecting sample
 * points by repeatedly stepping and snapping back to the contour.
 *
 * @param stepWorldUnits   World-unit distance between successive sample points.
 * @param numSteps         Number of steps to collect in each direction.
 */
export function traceDepthContourSegment(
  grid: TerrainData,
  startX: number,
  startZ: number,
  targetDepthM: number,
  stepWorldUnits: number = 0.6,
  numSteps: number = 24,
): Array<{ x: number; z: number }> {
  const EPS = 0.15;
  const depthAt = (x: number, z: number) => sampleDepthAt(grid, x, z);
  const half = WORLD_SIZE / 2;

  const snapToContour = (px: number, pz: number): { x: number; z: number } | null =>
    snapWorldXZToDepthContour(grid, px, pz, targetDepthM, stepWorldUnits * 3);

  const getPerp = (x: number, z: number): { px: number; pz: number } => {
    const dX = depthAt(x + EPS, z) - depthAt(x - EPS, z);
    const dZ = depthAt(x, z + EPS) - depthAt(x, z - EPS);
    const len = Math.sqrt(dX * dX + dZ * dZ) || 1;
    // Perpendicular to gradient (rotate 90°): (-dZ, dX)
    return { px: -dZ / len, pz: dX / len };
  };

  const inBounds = (x: number, z: number) =>
    x > -half && x < half && z > -half && z < half;

  const walkDir = (dirSign: 1 | -1): Array<{ x: number; z: number }> => {
    const pts: Array<{ x: number; z: number }> = [];
    let cx = startX;
    let cz = startZ;
    for (let i = 0; i < numSteps; i++) {
      const { px, pz } = getPerp(cx, cz);
      const nx = cx + px * stepWorldUnits * dirSign;
      const nz = cz + pz * stepWorldUnits * dirSign;
      if (!inBounds(nx, nz)) break;
      const snapped = snapToContour(nx, nz);
      if (!snapped) break;
      pts.push(snapped);
      cx = snapped.x;
      cz = snapped.z;
    }
    return pts;
  };

  const backward = walkDir(-1).reverse();
  const forward = walkDir(1);

  return [...backward, { x: startX, z: startZ }, ...forward];
}

/**
 * Convert geographic longitude/latitude to world-space XZ coordinates.
 */
export function lonLatToWorldXZ(
  lon: number,
  lat: number,
  grid: TerrainData,
): { x: number; z: number } {
  const lonRange = grid.maxLon - grid.minLon || 1;
  const latRange = grid.maxLat - grid.minLat || 1;
  const x = ((lon - grid.minLon) / lonRange) * WORLD_SIZE - WORLD_SIZE / 2;
  const z = ((lat - grid.minLat) / latRange) * WORLD_SIZE - WORLD_SIZE / 2;
  return { x, z };
}

/**
 * True when a terrain grid's data source is synthetic (procedurally
 * generated fallback) rather than real surveyed bathymetry. Drives the
 * rainbow "SIMULATED" treatment in the 3D scene and Overview Map.
 */
export function isSyntheticGrid(
  grid: Pick<TerrainData, "synthetic" | "dataSource">,
): boolean {
  return grid.synthetic === true || grid.dataSource === "synthetic";
}
