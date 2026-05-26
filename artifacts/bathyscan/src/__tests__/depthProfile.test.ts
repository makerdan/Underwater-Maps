import { describe, it, expect } from "vitest";
import {
  buildProfile,
  detectProfileFeatures,
  type DepthProfileResult,
  type ProfilePoint,
} from "../lib/depthProfileStore";
import type { TerrainData } from "@workspace/api-client-react";

function profileFromDepths(depths: number[]): DepthProfileResult {
  const totalDistanceM = (depths.length - 1) * 10;
  const points: ProfilePoint[] = depths.map((depthM, i) => ({
    distanceM: i * 10,
    depthM,
    slot: null,
    worldX: i,
    worldZ: 0,
    lon: 0,
    lat: 0,
  }));
  return {
    start: { lon: 0, lat: 0, depth: depths[0]! },
    end: { lon: 0, lat: 0, depth: depths[depths.length - 1]! },
    points,
    totalDistanceM,
    minDepthM: Math.min(...depths),
    maxDepthM: Math.max(...depths),
    at: 0,
  };
}

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

  it("records lon/lat per sample, endpoints match start/end exactly", () => {
    const start = { lon: -132.5, lat: 56.0, depth: 0 };
    const end = { lon: -132.3, lat: 56.05, depth: 1000 };
    const r = buildProfile(grid, start, end, null);
    expect(r.points[0]!.lon).toBeCloseTo(start.lon, 6);
    expect(r.points[0]!.lat).toBeCloseTo(start.lat, 6);
    expect(r.points[r.points.length - 1]!.lon).toBeCloseTo(end.lon, 6);
    expect(r.points[r.points.length - 1]!.lat).toBeCloseTo(end.lat, 6);
    for (const p of r.points) {
      expect(p.lon).toBeGreaterThanOrEqual(grid.minLon);
      expect(p.lon).toBeLessThanOrEqual(grid.maxLon);
      expect(p.lat).toBeGreaterThanOrEqual(grid.minLat);
      expect(p.lat).toBeLessThanOrEqual(grid.maxLat);
    }
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

describe("detectProfileFeatures", () => {
  it("returns no features for a flat profile", () => {
    const p = profileFromDepths(new Array(96).fill(50));
    expect(detectProfileFeatures(p)).toEqual([]);
  });

  it("returns no features for a short profile (<5 samples)", () => {
    const p = profileFromDepths([10, 20, 30, 40]);
    expect(detectProfileFeatures(p)).toEqual([]);
  });

  it("flags a prominent hump (peak) and the surrounding holes (troughs)", () => {
    // Bowl with a sharp shallow spike in the middle: deep → shallow → deep.
    const depths: number[] = [];
    for (let i = 0; i < 96; i++) {
      // Default deep value
      let d = 100;
      // A prominent peak at idx 48 — much shallower than neighbours
      if (i === 48) d = 20;
      else if (i === 47 || i === 49) d = 60;
      depths.push(d);
    }
    const features = detectProfileFeatures(profileFromDepths(depths));
    const peak = features.find((f) => f.kind === "peak");
    expect(peak).toBeDefined();
    expect(peak!.index).toBe(48);
    expect(peak!.magnitude).toBeGreaterThan(0);
  });

  it("flags a prominent trough (hole) in an otherwise shallow profile", () => {
    const depths: number[] = new Array(96).fill(10);
    depths[50] = 200;
    depths[49] = 80;
    depths[51] = 80;
    const features = detectProfileFeatures(profileFromDepths(depths));
    const trough = features.find((f) => f.kind === "trough");
    expect(trough).toBeDefined();
    expect(trough!.index).toBe(50);
  });

  it("ignores tiny ripples below the prominence threshold", () => {
    // Linear ramp gives a meaningful range so the slope threshold scales up
    // and a 2m wobble against a 1000m range stays below both bars.
    const depths: number[] = [];
    for (let i = 0; i < 96; i++) depths.push((i / 95) * 1000);
    depths[70] = depths[70]! - 2;
    const features = detectProfileFeatures(profileFromDepths(depths));
    expect(features.find((f) => f.index === 70)).toBeUndefined();
  });

  it("flags a ledge at a sharp drop-off", () => {
    // Flat shallow → sharp drop → flat deep.
    const depths: number[] = [];
    for (let i = 0; i < 96; i++) depths.push(i < 48 ? 10 : 200);
    const features = detectProfileFeatures(profileFromDepths(depths));
    const ledge = features.find((f) => f.kind === "ledge");
    expect(ledge).toBeDefined();
    // Drop happens around the i=47→48 boundary.
    expect(Math.abs(ledge!.index - 48)).toBeLessThanOrEqual(2);
  });

  it("features are sorted by index", () => {
    const depths: number[] = new Array(96).fill(100);
    depths[20] = 20;     // hump
    depths[19] = 60; depths[21] = 60;
    depths[70] = 200;    // hole
    depths[69] = 150; depths[71] = 150;
    const features = detectProfileFeatures(profileFromDepths(depths));
    for (let i = 1; i < features.length; i++) {
      expect(features[i]!.index).toBeGreaterThan(features[i - 1]!.index);
    }
  });
});
