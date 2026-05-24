import * as THREE from "three";
import type { TerrainData } from "@workspace/api-client-react";
import { depthToColor } from "./colormap";

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

  const positions = geometry.attributes.position.array as Float32Array;
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
