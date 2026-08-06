/**
 * Unit tests for worldYToDepthFt — pure terrain helper that converts a
 * world-space Y coordinate to an absolute display depth value.
 *
 * These four cases pin the formula against both zero and nonzero minDepth
 * at both extremes of the depth range:
 *
 *   bottomY=  0, minDepth=  0, maxDepth=100 → 0    (shallowest, zero offset)
 *   bottomY=-50, minDepth=  0, maxDepth=100 → 100  (deepest, zero offset)
 *   bottomY=  0, minDepth= 50, maxDepth=150 → 50   (shallowest, nonzero offset)
 *   bottomY=-50, minDepth= 50, maxDepth=150 → 150  (deepest, nonzero offset)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("three");
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import { worldYToDepthFt, MAX_DEPTH_WORLD } from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

function makeGrid(minDepth: number, maxDepth: number): TerrainData {
  return {
    datasetId: "test",
    name: "Test",
    waterType: "saltwater",
    resolution: 2,
    width: 2,
    height: 2,
    depths: [minDepth, minDepth, maxDepth, maxDepth],
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

describe("worldYToDepthFt", () => {
  it("bottomY=0, minDepth=0, maxDepth=100 → 0 (shallowest point, zero-offset grid)", () => {
    const terrain = makeGrid(0, 100);
    expect(worldYToDepthFt(0, terrain)).toBeCloseTo(0, 5);
  });

  it(`bottomY=-${MAX_DEPTH_WORLD}, minDepth=0, maxDepth=100 → 100 (deepest point, zero-offset grid)`, () => {
    const terrain = makeGrid(0, 100);
    expect(worldYToDepthFt(-MAX_DEPTH_WORLD, terrain)).toBeCloseTo(100, 5);
  });

  it("bottomY=0, minDepth=50, maxDepth=150 → 50 (shallowest point, nonzero-offset grid)", () => {
    const terrain = makeGrid(50, 150);
    expect(worldYToDepthFt(0, terrain)).toBeCloseTo(50, 5);
  });

  it(`bottomY=-${MAX_DEPTH_WORLD}, minDepth=50, maxDepth=150 → 150 (deepest, nonzero-offset grid)`, () => {
    const terrain = makeGrid(50, 150);
    expect(worldYToDepthFt(-MAX_DEPTH_WORLD, terrain)).toBeCloseTo(150, 5);
  });

  it("uses Math.abs so positive bottomY gives the same result as negative (symmetry guard)", () => {
    const terrain = makeGrid(0, 100);
    expect(worldYToDepthFt(25, terrain)).toBeCloseTo(worldYToDepthFt(-25, terrain), 5);
  });

  it("clamps |bottomY| > MAX_DEPTH_WORLD to the deepest depth", () => {
    const terrain = makeGrid(0, 100);
    expect(worldYToDepthFt(-MAX_DEPTH_WORLD * 2, terrain)).toBeCloseTo(100, 5);
  });

  it("degenerate terrain (minDepth === maxDepth) does not throw or return NaN", () => {
    const terrain = makeGrid(50, 50);
    const result = worldYToDepthFt(-25, terrain);
    expect(Number.isFinite(result)).toBe(true);
  });
});
