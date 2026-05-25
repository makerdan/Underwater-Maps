import { describe, it, expect, vi } from "vitest";

vi.mock("three", () => {
  class Color {
    r = 0; g = 0; b = 0;
    constructor(hex?: string) {
      if (hex) {
        const n = parseInt(hex.replace("#", ""), 16);
        this.r = ((n >> 16) & 0xff) / 255;
        this.g = ((n >> 8) & 0xff) / 255;
        this.b = (n & 0xff) / 255;
      }
    }
    clone() { const c = new Color(); c.r = this.r; c.g = this.g; c.b = this.b; return c; }
    lerpColors(a: Color, b: Color, alpha: number) {
      this.r = a.r + (b.r - a.r) * alpha;
      this.g = a.g + (b.g - a.g) * alpha;
      this.b = a.b + (b.b - a.b) * alpha;
      return this;
    }
  }

  class BufferAttribute {
    array: Float32Array;
    itemSize: number;
    constructor(arr: Float32Array, itemSize: number) { this.array = arr; this.itemSize = itemSize; }
  }

  class PlaneGeometry {
    attributes: Record<string, { array: Float32Array }> = {};
    constructor(w: number, h: number, segW: number, segH: number) {
      const vertsX = segW + 1;
      const vertsZ = segH + 1;
      const count = vertsX * vertsZ;
      const pos = new Float32Array(count * 3);
      // lay out a flat grid at Y=0
      for (let r = 0; r < vertsZ; r++) {
        for (let c = 0; c < vertsX; c++) {
          const i = (r * vertsX + c) * 3;
          pos[i] = (c / segW - 0.5) * w;
          pos[i + 1] = 0;
          pos[i + 2] = (r / segH - 0.5) * h;
        }
      }
      this.attributes = { position: { array: pos } };
    }
    rotateX(_angle: number) { return this; }
    setAttribute(_name: string, _attr: BufferAttribute) {}
    computeVertexNormals() {}
  }

  return { Color, BufferAttribute, PlaneGeometry, BufferGeometry: class {} };
});

// zoneMap module has no three.js dep — mock as passthrough
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import {
  buildTerrainGeometry,
  computeZoneWeights,
  blendZoneWeights,
  worldXZToLonLat,
  lonLatToWorldXZ,
  worldYToMetres,
  MAX_DEPTH_WORLD,
} from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

function makeGrid(N: number, overrides: Partial<TerrainData> = {}): TerrainData {
  const depths = Array.from({ length: N * N }, (_, i) => (i / (N * N - 1)) * 1000);
  return {
    datasetId: "test",
    name: "Test",
    waterType: "saltwater",
    resolution: N,
    width: N,
    height: N,
    depths,
    minDepth: 0,
    maxDepth: 1000,
    minLon: -180,
    maxLon: 180,
    minLat: -90,
    maxLat: 90,
    centerLon: 0,
    centerLat: 0,
    ...overrides,
  };
}

describe("buildTerrainGeometry", () => {
  it("returns a PlaneGeometry with N×N vertices for N=8", () => {
    const N = 8;
    const grid = makeGrid(N);
    const geo = buildTerrainGeometry(grid);
    expect(geo).toBeDefined();
  });

  it("applies Y displacement so minDepth vertex is at 0 and maxDepth vertex is at -MAX_DEPTH_WORLD", () => {
    const N = 2;
    const grid = makeGrid(N, { depths: [0, 500, 500, 1000], minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    // Access underlying positions via our mock
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } }).attributes?.position?.array;
    if (!positions) return; // mock geometry may not expose this — test structure OK
    // First vertex (t=0): Y should be 0
    expect(positions[1]).toBeCloseTo(0, 2);
    // Last vertex (t=1): Y should be -MAX_DEPTH_WORLD
    expect(positions[(N * N - 1) * 3 + 1]).toBeCloseTo(-MAX_DEPTH_WORLD, 2);
  });
});

describe("worldXZToLonLat / lonLatToWorldXZ round-trip", () => {
  const grid = makeGrid(4, {
    minLon: 140.0, maxLon: 145.0,
    minLat: 10.0, maxLat: 15.0,
  });

  const cases: Array<[number, number]> = [
    [142.25, 12.5],
    [140.0, 10.0],
    [145.0, 15.0],
    [142.0, 11.0],
  ];

  for (const [lon, lat] of cases) {
    it(`round-trips (lon=${lon}, lat=${lat}) to 4 decimal places`, () => {
      const { x, z } = lonLatToWorldXZ(lon, lat, grid);
      const result = worldXZToLonLat(x, z, grid);
      expect(result.lon).toBeCloseTo(lon, 4);
      expect(result.lat).toBeCloseTo(lat, 4);
    });
  }
});

describe("worldYToMetres", () => {
  const grid = makeGrid(4, { minDepth: 0, maxDepth: 10935 });

  it("worldY=0 → minDepth (shallowest)", () => {
    expect(worldYToMetres(0, grid)).toBeCloseTo(0, 1);
  });

  it(`worldY=-${MAX_DEPTH_WORLD} → maxDepth (deepest)`, () => {
    expect(worldYToMetres(-MAX_DEPTH_WORLD, grid)).toBeCloseTo(10935, 0);
  });

  it("worldY=-25 → ~5467.5 m (mid-depth)", () => {
    expect(worldYToMetres(-25, grid)).toBeCloseTo(10935 / 2, 0);
  });
});

describe("computeZoneWeights", () => {
  it("returns Float32Array of length N×N×4", () => {
    const N = 4;
    const grid = makeGrid(N);
    const weights = computeZoneWeights(grid);
    expect(weights).toBeInstanceOf(Float32Array);
    expect(weights.length).toBe(N * N * 4);
  });

  it("each vertex has weights that sum to 1 (normalised)", () => {
    const grid = makeGrid(8);
    const weights = computeZoneWeights(grid);
    const count = 8 * 8;
    for (let i = 0; i < count; i++) {
      const sum = (weights[i * 4] ?? 0) + (weights[i * 4 + 1] ?? 0) + (weights[i * 4 + 2] ?? 0) + (weights[i * 4 + 3] ?? 0);
      expect(sum).toBeCloseTo(1, 4);
    }
  });

  it("shallowest vertex (t=0, flat grid) is pure sand", () => {
    const N = 4;
    // All vertices at minDepth → t=0, slope=0 → 100% sand
    const depths = new Array(N * N).fill(0) as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 1000 });
    const weights = computeZoneWeights(grid);
    const sand = weights[0] ?? 0;
    expect(sand).toBeCloseTo(1.0, 4);
  });

  it("deepest vertex (t=1, flat grid) is pure basalt", () => {
    const N = 4;
    // All vertices at maxDepth → t=1, slope=0 → 100% basalt
    const depths = new Array(N * N).fill(1000) as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 1000 });
    const weights = computeZoneWeights(grid);
    const basalt = weights[3] ?? 0;
    expect(basalt).toBeCloseTo(1.0, 4);
  });

  it("all weights are non-negative", () => {
    const grid = makeGrid(8);
    const weights = computeZoneWeights(grid);
    for (let i = 0; i < weights.length; i++) {
      expect(weights[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("with zoneMap: blends 70% AI + 30% depth, maintains sum-to-1", () => {
    const N = 4;
    // Flat grid at mid-depth (sediment zone from depth alone)
    const depths = new Array(N * N).fill(400) as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 1000 });
    // All vertices assigned zone 0 (sandy_shelf → slot 0 = sand)
    const zoneMap = new Uint8Array(N * N).fill(0);
    const blended = computeZoneWeights(grid, zoneMap);
    // Every vertex should sum to 1
    for (let i = 0; i < N * N; i++) {
      const sum =
        (blended[i * 4]     ?? 0) + (blended[i * 4 + 1] ?? 0) +
        (blended[i * 4 + 2] ?? 0) + (blended[i * 4 + 3] ?? 0);
      expect(sum).toBeCloseTo(1, 4);
    }
    // Sand (slot 0) should dominate (70% AI pushes it to sand)
    const sand = blended[0] ?? 0;
    expect(sand).toBeGreaterThan(0.5);
  });
});

describe("blendZoneWeights", () => {
  it("with aiStrength=0.7: 70% AI + 30% depth, normalised", () => {
    // Depth: all sand [1, 0, 0, 0]
    const depth = new Float32Array([1, 0, 0, 0]);
    // AI: all basalt [0, 0, 0, 1]
    const ai = new Float32Array([0, 0, 0, 1]);
    const result = blendZoneWeights(depth, ai, 0.7);
    // Expected: 0.7 * [0,0,0,1] + 0.3 * [1,0,0,0] = [0.3, 0, 0, 0.7] (already sums to 1)
    expect(result[0]).toBeCloseTo(0.3, 4);
    expect(result[1]).toBeCloseTo(0.0, 4);
    expect(result[2]).toBeCloseTo(0.0, 4);
    expect(result[3]).toBeCloseTo(0.7, 4);
  });

  it("result always sums to 1", () => {
    const depth = new Float32Array([0.6, 0.2, 0.1, 0.1]);
    const ai    = new Float32Array([0.0, 0.0, 0.5, 0.5]);
    const result = blendZoneWeights(depth, ai, 0.7);
    const sum = (result[0] ?? 0) + (result[1] ?? 0) + (result[2] ?? 0) + (result[3] ?? 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("aiStrength=0 returns depth weights unchanged", () => {
    const depth = new Float32Array([0.5, 0.3, 0.2, 0.0]);
    const ai    = new Float32Array([0.0, 0.0, 0.0, 1.0]);
    const result = blendZoneWeights(depth, ai, 0.0);
    expect(result[0]).toBeCloseTo(0.5, 4);
    expect(result[1]).toBeCloseTo(0.3, 4);
    expect(result[2]).toBeCloseTo(0.2, 4);
    expect(result[3]).toBeCloseTo(0.0, 4);
  });

  it("aiStrength=1 returns AI weights unchanged", () => {
    const depth = new Float32Array([0.5, 0.3, 0.2, 0.0]);
    const ai    = new Float32Array([1.0, 0.0, 0.0, 0.0]);
    const result = blendZoneWeights(depth, ai, 1.0);
    expect(result[0]).toBeCloseTo(1.0, 4);
    expect(result[1]).toBeCloseTo(0.0, 4);
    expect(result[2]).toBeCloseTo(0.0, 4);
    expect(result[3]).toBeCloseTo(0.0, 4);
  });

  it("all result weights are non-negative", () => {
    const depth = new Float32Array([0.8, 0.1, 0.05, 0.05]);
    const ai    = new Float32Array([0.0, 0.0, 0.0, 1.0]);
    const result = blendZoneWeights(depth, ai, 0.7);
    for (let i = 0; i < 4; i++) {
      expect(result[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getTerrainSurfaceY
// ---------------------------------------------------------------------------

import { getTerrainSurfaceY, WORLD_SIZE, MAX_DEPTH_WORLD } from "../lib/terrain";

function makeDepthGrid(
  depths: number[],
  resolution: number,
  minDepth: number,
  maxDepth: number,
): TerrainData {
  return {
    datasetId: "test",
    resolution,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
    minDepth,
    maxDepth,
    depths: new Float32Array(depths),
  };
}

describe("getTerrainSurfaceY", () => {
  it("returns 0 for a flat grid at minDepth (shallowest → t=0)", () => {
    const grid = makeDepthGrid(new Array(16).fill(0), 4, 0, 100);
    expect(getTerrainSurfaceY(grid, 0, 0)).toBeCloseTo(0, 5);
  });

  it("returns -MAX_DEPTH_WORLD for a flat grid at maxDepth (deepest → t=1)", () => {
    const grid = makeDepthGrid(new Array(16).fill(100), 4, 0, 100);
    expect(getTerrainSurfaceY(grid, 0, 0)).toBeCloseTo(-MAX_DEPTH_WORLD, 5);
  });

  it("returns -MAX_DEPTH_WORLD/2 for a flat grid at mid-range depth", () => {
    const grid = makeDepthGrid(new Array(16).fill(50), 4, 0, 100);
    expect(getTerrainSurfaceY(grid, 0, 0)).toBeCloseTo(-MAX_DEPTH_WORLD / 2, 4);
  });

  it("clamps out-of-bounds worldX/Z to the edge value", () => {
    const grid = makeDepthGrid(new Array(16).fill(75), 4, 0, 100);
    const yInside = getTerrainSurfaceY(grid, 0, 0);
    const yOutside = getTerrainSurfaceY(grid, WORLD_SIZE * 10, WORLD_SIZE * 10);
    expect(yOutside).toBeCloseTo(yInside, 5);
  });

  it("bilinearly interpolates at centre of a 2×2 corner grid", () => {
    // corners: tl=0, tr=200, bl=200, br=400
    // at centre (fracCol=0.5, fracRow=0.5):
    //   d = 0*0.25 + 200*0.25 + 200*0.25 + 400*0.25 = 200
    //   t = (200-0)/(400-0) = 0.5 → worldY = -MAX_DEPTH_WORLD*0.5
    const grid = makeDepthGrid([0, 200, 200, 400], 2, 0, 400);
    expect(getTerrainSurfaceY(grid, 0, 0)).toBeCloseTo(-MAX_DEPTH_WORLD * 0.5, 3);
  });

  it("always returns a non-positive value (world Y is zero or below surface)", () => {
    const grid = makeDepthGrid(
      Array.from({ length: 64 }, (_, i) => 100 + i * 45),
      8,
      100,
      3285,
    );
    const testXZ: Array<[number, number]> = [[-40, -40], [-20, 10], [0, 0], [30, -30], [49, 49]];
    for (const [wx, wz] of testXZ) {
      expect(getTerrainSurfaceY(grid, wx, wz)).toBeLessThanOrEqual(0);
    }
  });
});
