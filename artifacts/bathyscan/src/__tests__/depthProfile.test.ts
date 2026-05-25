import { describe, it, expect } from "vitest";
import { buildProfile } from "../lib/depthProfileStore";
import type { TerrainData } from "@workspace/api-client-react";

function makeRamp(N: number): TerrainData {
  // Depth ramps linearly from 0 (shallow) at the west edge to 1000m at the
  // east edge, constant across rows. minLon/minLat span a small area off
  // BC, so haversine distance is non-trivial.
  const depths = new Float32Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      depths[r * N + c] = (c / (N - 1)) * 1000;
    }
  }
  return {
    datasetId: "ramp",
    name: "ramp",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths: Array.from(depths),
    minDepth: 0,
    maxDepth: 1000,
    minLon: -132.5,
    maxLon: -132.3,
    minLat: 55.9,
    maxLat: 56.1,
    centerLon: -132.4,
    centerLat: 56.0,
  } as unknown as TerrainData;
}

describe("buildProfile", () => {
  const grid = makeRamp(32);

  it("produces 96 samples", () => {
    const r = buildProfile(
      grid,
      { lon: -132.5, lat: 56.0, depth: 0 },
      { lon: -132.3, lat: 56.0, depth: 1000 },
      null,
    );
    expect(r.points).toHaveLength(96);
  });

  it("samples have monotonically non-decreasing distance starting at 0", () => {
    const r = buildProfile(
      grid,
      { lon: -132.5, lat: 56.0, depth: 0 },
      { lon: -132.3, lat: 56.0, depth: 1000 },
      null,
    );
    expect(r.points[0]!.distanceM).toBe(0);
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i]!.distanceM).toBeGreaterThanOrEqual(
        r.points[i - 1]!.distanceM,
      );
    }
    expect(r.points[r.points.length - 1]!.distanceM).toBeCloseTo(
      r.totalDistanceM,
      3,
    );
  });

  it("depth bounds bracket every sampled depth and match the grid range", () => {
    const r = buildProfile(
      grid,
      { lon: -132.5, lat: 56.0, depth: 0 },
      { lon: -132.3, lat: 56.0, depth: 1000 },
      null,
    );
    for (const p of r.points) {
      expect(p.depthM).toBeGreaterThanOrEqual(r.minDepthM);
      expect(p.depthM).toBeLessThanOrEqual(r.maxDepthM);
      expect(p.depthM).toBeGreaterThanOrEqual(0);
      expect(p.depthM).toBeLessThanOrEqual(1000);
    }
    // West→east transect across the ramp should span ~the full depth range.
    expect(r.minDepthM).toBeLessThan(50);
    expect(r.maxDepthM).toBeGreaterThan(950);
  });

  it("totalDistanceM is a positive, finite haversine distance", () => {
    const r = buildProfile(
      grid,
      { lon: -132.5, lat: 56.0, depth: 0 },
      { lon: -132.3, lat: 56.0, depth: 0 },
      null,
    );
    expect(Number.isFinite(r.totalDistanceM)).toBe(true);
    expect(r.totalDistanceM).toBeGreaterThan(0);
  });

  it("slot is null when no zoneMap is provided", () => {
    const r = buildProfile(
      grid,
      { lon: -132.5, lat: 56.0, depth: 0 },
      { lon: -132.3, lat: 56.0, depth: 1000 },
      null,
    );
    expect(r.points.every((p) => p.slot === null)).toBe(true);
  });

  it("anchor === end produces zero-length transect with constant depth", () => {
    const r = buildProfile(
      grid,
      { lon: -132.4, lat: 56.0, depth: 500 },
      { lon: -132.4, lat: 56.0, depth: 500 },
      null,
    );
    expect(r.totalDistanceM).toBe(0);
    expect(r.points).toHaveLength(96);
    for (const p of r.points) {
      expect(p.distanceM).toBe(0);
    }
    expect(r.maxDepthM - r.minDepthM).toBeLessThan(1e-6);
  });
});
