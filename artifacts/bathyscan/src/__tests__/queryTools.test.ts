import { describe, it, expect, vi } from "vitest";
import { computeStatistic, computeSlopeAttribute } from "../lib/terrain";
import type { TerrainData } from "@workspace/api-client-react";

// Mock three (required by terrain.ts → terrainShader imports, etc.)
vi.mock("three", () => {
  class Vector3 {
    x = 0; y = 0; z = 0;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    normalize() { return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  }
  class Color {
    r = 0; g = 0; b = 0;
    constructor(hex?: number) {
      if (hex !== undefined) {
        this.r = ((hex >> 16) & 0xff) / 255;
        this.g = ((hex >> 8) & 0xff) / 255;
        this.b = (hex & 0xff) / 255;
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
    array: Float32Array; itemSize: number;
    constructor(arr: Float32Array, itemSize: number) { this.array = arr; this.itemSize = itemSize; }
  }
  class PlaneGeometry {
    attributes: Record<string, { array: Float32Array }> = {};
    constructor(w: number, h: number, segW: number, segH: number) {
      const vX = segW + 1; const vZ = segH + 1;
      const pos = new Float32Array(vX * vZ * 3);
      for (let r = 0; r < vZ; r++) for (let c = 0; c < vX; c++) {
        const i = (r * vX + c) * 3;
        pos[i] = (c / segW - 0.5) * w; pos[i + 1] = 0; pos[i + 2] = (r / segH - 0.5) * h;
      }
      this.attributes = { position: { array: pos } };
    }
    rotateX(_a: number) { return this; }
    setAttribute(_n: string, _a: BufferAttribute) {}
    computeVertexNormals() {}
  }
  class ShaderMaterial {
    uniforms: Record<string, { value: unknown }> = {};
    constructor(opts: { uniforms?: Record<string, { value: unknown }> } = {}) {
      this.uniforms = opts.uniforms ?? {};
    }
    dispose() {}
  }
  return { Color, Vector3, BufferAttribute, PlaneGeometry, ShaderMaterial, DoubleSide: 2 };
});

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
    const _grid = { ...makeGrid(d, 8), resolution: 8, width: 8, height: 8 };
    void _grid;
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
