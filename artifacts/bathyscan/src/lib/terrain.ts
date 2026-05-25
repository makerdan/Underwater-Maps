import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { depthToColor } from "./colormap";
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
 * - Assigns per-vertex colour from depthToColor(t).
 * - Recomputes vertex normals for correct lighting.
 */
export function buildTerrainGeometry(grid: TerrainData): THREE.BufferGeometry {
  const { resolution: N, depths, minDepth, maxDepth } = grid;
  const depthRange = (maxDepth - minDepth) || 1;

  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, N - 1, N - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes["position"]!.array as Float32Array;
  const colors = new Float32Array(positions.length);

  for (let i = 0; i < depths.length; i++) {
    const depth = depths[i] ?? 0;
    const t = (depth - minDepth) / depthRange;
    const clampedT = Math.max(0, Math.min(1, t));

    // After rotateX(-PI/2), index 1 of each vertex triplet is world Y (up/down)
    positions[i * 3 + 1] = -clampedT * MAX_DEPTH_WORLD;

    const c = depthToColor(clampedT);
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
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

      // Normalised depth [0 = shallow, 1 = deepest]
      const depth = depths[idx] ?? 0;
      const t = Math.max(0, Math.min(1, (depth - minDepth) / depthRange));

      // Base zone weights via soft overlapping ramps
      let wSand     = 1 - smoothstep(0.12, 0.30, t);
      let wSediment = smoothstep(0.10, 0.28, t) * (1 - smoothstep(0.48, 0.65, t));
      let wSilt     = smoothstep(0.44, 0.60, t) * (1 - smoothstep(0.76, 0.90, t));
      let wBasalt   = smoothstep(0.74, 0.88, t);

      // Slope override: steep faces expose hard basalt regardless of depth
      const tOf = (r: number, c: number): number => {
        const d = depths[r * N + c] ?? 0;
        return (d - minDepth) / depthRange;
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
