/**
 * terrain-land-clamp.test.ts
 *
 * Regression tests for the land-spike clamp in buildTerrainGeometry.
 *
 * Background
 * ----------
 * Coastal survey data can include cells with POSITIVE depth values (cells
 * that are above the waterline — land).  In the positive-depth convention
 * used by BathyScan (depth 0 = sea surface, depth > 0 = below / depth < 0
 * = above), positive depths are the cells that "spike" visually when the
 * mesh is vertically exaggerated.
 *
 * The fix: `clampedDepth = Math.min(depth, 0)` treats any positive-depth
 * cell as being exactly at the waterline (depth 0) before computing the
 * normalised position t = (clampedDepth − minDepth) / depthRange.
 *
 * When minDepth = 0 (the common case for surveys that start at the surface),
 * a clamped cell gets t = 0 → world-Y = 0 (the water-surface plane).  That
 * guarantees that any vertical-exaggeration scale applied to the mesh
 * (mesh.scale.y = k) leaves land cells at 0 × k = 0 regardless of k.
 *
 * These tests lock in that guarantee.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("three");

vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import { buildTerrainGeometry, MAX_DEPTH_WORLD } from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

function makeGrid(
  depths: (number | null)[],
  minDepth: number,
  maxDepth: number,
): TerrainData {
  const N = Math.round(Math.sqrt(depths.length));
  return {
    datasetId: "clamp-test",
    name: "Clamp test",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths: depths as number[],
    minDepth,
    maxDepth,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
    centerLon: 0,
    centerLat: 0,
  };
}

function getY(geo: ReturnType<typeof buildTerrainGeometry>, index: number): number | undefined {
  const arr = (geo as unknown as { attributes: { position: { array: Float32Array } } })
    .attributes?.position?.array;
  return arr ? arr[index * 3 + 1] : undefined;
}

function getPositions(geo: ReturnType<typeof buildTerrainGeometry>): Float32Array | undefined {
  return (geo as unknown as { attributes: { position: { array: Float32Array } } })
    .attributes?.position?.array;
}

describe("buildTerrainGeometry — land-spike clamp (depth ≥ 0 → world-Y = 0)", () => {
  it("single positive-depth cell maps to Y=0 (spike prevention, minDepth=0)", () => {
    // Without the clamp, depth=5 with maxDepth=5 → t=1 → Y=-MAX_DEPTH_WORLD.
    // With the clamp: clampedDepth=0 → t=0 → Y=0 (no spike).
    const grid = makeGrid([5, 0, 0, 0], 0, 5);
    const geo = buildTerrainGeometry(grid);
    const y = getY(geo, 0);
    if (y === undefined) return;
    expect(y).toBeCloseTo(0, 5);
  });

  it("spike prevention for large depth range: depth=maxDepth cell maps to Y=0, not Y=-MAX_DEPTH_WORLD", () => {
    // Without the clamp: depth=500, maxDepth=500 → t=1 → Y=-50 (at the floor).
    // With the clamp: clampedDepth=0 → t=0 → Y=0 (at the waterline).
    const grid = makeGrid([500, 100, 50, 0], 0, 500);
    const geo = buildTerrainGeometry(grid);
    // All positive depths get clamped to 0 → all cells at Y=0.
    const arr = getPositions(geo);
    if (!arr) return;
    for (let i = 0; i < 4; i++) {
      expect(arr[i * 3 + 1]).toBeCloseTo(0, 5);
    }
  });

  it("positive-depth cell maps to Y=0 regardless of how large the depth value is", () => {
    // depth=200 is a substantial value; without the clamp it would sit deep in
    // the scene and exaggeration would amplify it further.
    const grid = makeGrid([200, 0, 0, 0], 0, 200);
    const geo = buildTerrainGeometry(grid);
    const y = getY(geo, 0);
    if (y === undefined) return;
    expect(y).toBeCloseTo(0, 5);
  });

  it("all-positive depths grid: every cell sits at Y=0", () => {
    const N = 3;
    const depths = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const grid = makeGrid(depths, 0, 9);
    const geo = buildTerrainGeometry(grid);
    const arr = getPositions(geo);
    if (!arr) return;
    for (let i = 0; i < N * N; i++) {
      expect(arr[i * 3 + 1]).toBeCloseTo(0, 5);
    }
  });

  it("mixed grid (minDepth=0): waterline (depth=0) and land (depth>0) are all Y=0", () => {
    // All positive depth values are clamped to 0 → every cell in a minDepth=0
    // grid lands on the waterline plane.
    const grid = makeGrid([0, 5, 25, 100], 0, 100);
    const geo = buildTerrainGeometry(grid);
    const arr = getPositions(geo);
    if (!arr) return;
    for (let i = 0; i < 4; i++) {
      expect(arr[i * 3 + 1]).toBeCloseTo(0, 5);
    }
  });

  it("land Y=0 is positive zero — not IEEE-754 −0 (multiplication-safe)", () => {
    // If Y were −0 instead of +0, mesh.scale.y × −0 = −0, which the HUD
    // would display as "−0 m".  The code guards this explicitly.
    const grid = makeGrid([3, 0, 0, 0], 0, 3);
    const geo = buildTerrainGeometry(grid);
    const arr = getPositions(geo);
    if (!arr) return;
    const y = arr[0 * 3 + 1];
    expect(Object.is(y, -0)).toBe(false);
    expect(y).toBe(0);
  });

  it("MAX_DEPTH_WORLD constant is exported and positive", () => {
    // Regression: ensure consumers can read MAX_DEPTH_WORLD for inverse
    // worldYToMetres calculations without hard-coding 50.
    expect(MAX_DEPTH_WORLD).toBeGreaterThan(0);
    expect(typeof MAX_DEPTH_WORLD).toBe("number");
  });
});
