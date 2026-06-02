import { describe, it, expect, vi } from "vitest";
import { computeStatistic, computeSlopeAttribute } from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

// ---------------------------------------------------------------------------
// Test grid factory
// ---------------------------------------------------------------------------

function makeGrid(depths: number[], N = 2): TerrainData {
  return {
    datasetId: "test",
    name: "Test",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: Math.min(...depths),
    maxDepth: Math.max(...depths),
    minLon: -10,
    maxLon: 10,
    minLat: -5,
    maxLat: 5,
    centerLon: 0,
    centerLat: 0,
    waterType: "saltwater",
  };
}

// ---------------------------------------------------------------------------
// computeStatistic tests
// ---------------------------------------------------------------------------

describe("computeStatistic", () => {
  it("returns correct mean_depth for uniform grid", () => {
    const grid = makeGrid([100, 100, 100, 100]);
    const result = computeStatistic("mean_depth", grid);
    expect(result).toBeCloseTo(100, 5);
  });

  it("returns correct mean_depth for varied grid", () => {
    const grid = makeGrid([100, 200, 300, 400]);
    const result = computeStatistic("mean_depth", grid);
    expect(result).toBeCloseTo(250, 5);
  });

  it("returns max_depth correctly", () => {
    const grid = makeGrid([50, 200, 150, 300]);
    expect(computeStatistic("max_depth", grid)).toBeCloseTo(300);
  });

  it("returns min_depth correctly", () => {
    const grid = makeGrid([50, 200, 150, 300]);
    expect(computeStatistic("min_depth", grid)).toBeCloseTo(50);
  });

  it("returns depth_std_dev = 0 for uniform depths", () => {
    const grid = makeGrid([250, 250, 250, 250]);
    expect(computeStatistic("depth_std_dev", grid)).toBeCloseTo(0, 10);
  });

  it("returns depth_std_dev correctly for known values", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → stddev = 2
    const d = [2, 4, 4, 4, 5, 5, 7, 9];
    // Provide a flat 8×1 grid (1 row × 8 cols)
    const g8 = makeGrid(d, 8);
    const result = computeStatistic("depth_std_dev", g8);
    expect(result).toBeCloseTo(2, 4);
  });

  it("returns area_km2 as a positive number", () => {
    const grid = makeGrid([100, 200, 300, 400]);
    const result = computeStatistic("area_km2", grid);
    expect(typeof result).toBe("number");
    expect(result as number).toBeGreaterThan(0);
  });

  it("deepest_coordinates points to the cell with maximum depth", () => {
    // 2×2 grid: [10, 10, 10, 999] — deepest is bottom-right (row=1, col=1)
    const grid = makeGrid([10, 10, 10, 999]);
    const result = computeStatistic("deepest_coordinates", grid);
    expect(typeof result).toBe("object");
    const coords = result as { lon: number; lat: number };
    // Bottom-right → maxLon=10, maxLat=5
    expect(coords.lon).toBeCloseTo(10, 3);
    expect(coords.lat).toBeCloseTo(5, 3);
  });

  it("shallowest_coordinates points to the cell with minimum depth", () => {
    // 2×2 grid: [1, 500, 500, 500] — shallowest is top-left (row=0, col=0)
    const grid = makeGrid([1, 500, 500, 500]);
    const result = computeStatistic("shallowest_coordinates", grid);
    expect(typeof result).toBe("object");
    const coords = result as { lon: number; lat: number };
    // Top-left → minLon=-10, minLat=-5
    expect(coords.lon).toBeCloseTo(-10, 3);
    expect(coords.lat).toBeCloseTo(-5, 3);
  });

  it("slope_mean is non-negative", () => {
    const grid = makeGrid([100, 200, 300, 900]);
    const result = computeStatistic("slope_mean", grid);
    expect(result as number).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeSlopeAttribute tests
// ---------------------------------------------------------------------------

describe("computeSlopeAttribute", () => {
  it("returns Float32Array of length N×N", () => {
    const grid = makeGrid([0, 0, 0, 0]);
    const slopes = computeSlopeAttribute(grid);
    expect(slopes).toBeInstanceOf(Float32Array);
    expect(slopes.length).toBe(4);
  });

  it("returns all zeros for a flat grid", () => {
    const grid = makeGrid([500, 500, 500, 500]);
    const slopes = computeSlopeAttribute(grid);
    for (let i = 0; i < slopes.length; i++) {
      expect(slopes[i]).toBeCloseTo(0, 3);
    }
  });

  it("returns non-zero slopes for a sloped grid", () => {
    const grid = makeGrid([100, 900, 100, 900]);
    const slopes = computeSlopeAttribute(grid);
    const hasNonZero = Array.from(slopes).some((s) => s > 0);
    expect(hasNonZero).toBe(true);
  });

  it("all slope values are non-negative", () => {
    const grid = makeGrid([0, 500, 1000, 500]);
    const slopes = computeSlopeAttribute(grid);
    for (let i = 0; i < slopes.length; i++) {
      expect(slopes[i]!).toBeGreaterThanOrEqual(0);
    }
  });
});
