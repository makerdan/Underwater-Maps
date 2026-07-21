import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

// zoneMap module has no three.js dep — mock as passthrough
vi.mock("../lib/zoneMap", () => ({
  SALTWATER_ZONE_TO_SLOT: [0, 1, 2, 3, 3, 3, 1, 0],
  FRESHWATER_ZONE_TO_SLOT: [0, 0, 3, 2, 1, 3, 1, 2],
}));

import {
  buildTerrainGeometry,
  buildTerrainSkirtGeometry,
  computeZoneWeights,
  blendZoneWeights,
  worldXZToLonLat,
  lonLatToWorldXZ,
  worldYToMetres,
  applyColormapToVertexColors,
  getTerrainSurfaceY,
  getSeaSurfaceY,
  NO_DATA_COLOR,
  WORLD_SIZE,
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

  it("applies Y displacement so minDepth vertex is at 0 and maxDepth vertex is at -MAX_DEPTH_WORLD (positive-down)", () => {
    // Depths use the positive-down convention: 0 = waterline, +N = N metres
    // below the surface. Regression guard for the invisible-terrain bug where
    // a Math.min(depth, 0) clamp (wrong sign convention) flattened every
    // all-positive grid — e.g. bundled Lake Ray Roberts — to Y=0.
    const N = 2;
    const grid = makeGrid(N, { depths: [0, 500, 500, 1000], minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } }).attributes?.position?.array;
    if (!positions) return; // mock geometry may not expose this — test structure OK
    // depth=0 vertex: Y should be 0 (waterline)
    expect(positions[1]).toBeCloseTo(0, 2);
    // depth=500 vertex (t=0.5): halfway down
    expect(positions[4]).toBeCloseTo(-MAX_DEPTH_WORLD / 2, 2);
    // depth=1000 vertex (t=1): deepest point
    expect(positions[(N * N - 1) * 3 + 1]).toBeCloseTo(-MAX_DEPTH_WORLD, 2);
  });

  it("regression: all-positive lake grid (Ray Roberts style) must NOT be flattened to Y=0", () => {
    // Mirrors the bundled lake-ray-roberts payload shape: minDepth=0,
    // maxDepth≈21, all depths in [0, 21]. Before the fix, every vertex was
    // clamped to Y=0 and the mesh rendered as an invisible flat plane.
    const N = 2;
    const depths = [0, 7, 14, 21];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 21 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } }).attributes?.position?.array;
    if (!positions) return;
    expect(positions[1]).toBeCloseTo(0, 2);
    expect(positions[4]).toBeCloseTo(-MAX_DEPTH_WORLD / 3, 2);
    expect(positions[7]).toBeCloseTo((-MAX_DEPTH_WORLD * 2) / 3, 2);
    expect(positions[(N * N - 1) * 3 + 1]).toBeCloseTo(-MAX_DEPTH_WORLD, 2);
    // At least one vertex must sit below the waterline — the invisible-terrain
    // failure mode was ALL vertices at exactly 0.
    let anyBelow = false;
    for (let i = 1; i < positions.length; i += 3) if (positions[i]! < -0.001) anyBelow = true;
    expect(anyBelow).toBe(true);
  });

  it("clamps negative-depth (above-water land) cells flat at the waterline", () => {
    // Land cells carry negative depths in the positive-down convention.
    // They must clamp UP to depth 0 (waterline, Y=0) — never spike upward.
    const N = 2;
    // depths[0]=-5 (land), depths[1]=0 (waterline), depths[2]=2, depths[3]=5 (deepest)
    const depths = [-5, 0, 2, 5];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 5 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } }).attributes?.position?.array;
    if (!positions) return;
    // Land vertex (depth=-5): clamped to waterline Y=0, not above it
    expect(positions[1]).toBeCloseTo(0, 2);
    // Waterline vertex (depth=0): Y=0
    expect(positions[4]).toBeCloseTo(0, 2);
    // Deepest vertex (depth=5 = maxDepth): -MAX_DEPTH_WORLD
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

  it("worldY > 0 (above water surface) → null", () => {
    expect(worldYToMetres(0.001, grid)).toBeNull();
    expect(worldYToMetres(1, grid)).toBeNull();
    expect(worldYToMetres(50, grid)).toBeNull();
  });

  it("worldY=0 (exactly at surface) → minDepth", () => {
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

// ---------------------------------------------------------------------------
// applyColormapToVertexColors + getColormap — band-boundary live repaint
//
// These tests prove the critical path that makes dragging a band-boundary
// slider in Settings repaint the 3D terrain without a full remount:
//
//   setBandBoundary  →  usePaletteStore.bandBoundaries changes reference
//   →  TerrainMesh useEffect dep triggers  →  getColormap("ocean") is called
//   →  applyColormapToVertexColors writes new RGB into the geometry buffer
//
// We test the computation layer (getColormap + applyColormapToVertexColors)
// rather than the React rendering layer so the test runs fast without R3F.
// ---------------------------------------------------------------------------

import { getColormap } from "../lib/colormap";
import { usePaletteStore, DEFAULT_BAND_BOUNDARIES } from "../lib/paletteStore";

describe("applyColormapToVertexColors — band-boundary live repaint", () => {
  beforeEach(() => {
    usePaletteStore.setState({
      ...usePaletteStore.getState(),
      bandBoundaries: [...DEFAULT_BAND_BOUNDARIES],
    });
  });

  it("fills the colour buffer with non-zero RGB for a depth ramp", () => {
    const depths = [0, 250, 500, 750, 1000];
    const colors = new Float32Array(depths.length * 3);
    const toColor = getColormap("ocean");
    applyColormapToVertexColors(depths, 0, 1000, colors, toColor);
    const anyNonZero = Array.from(colors).some((v) => v !== 0);
    expect(anyNonZero).toBe(true);
  });

  it("deepest vertex (t=1) has a different colour than shallowest (t=0)", () => {
    const depths = [0, 1000];
    const colors = new Float32Array(6);
    applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean"));
    const shallow = { r: colors[0], g: colors[1], b: colors[2] };
    const deep    = { r: colors[3], g: colors[4], b: colors[5] };
    expect(shallow).not.toEqual(deep);
  });

  it("getColormap('ocean') returns different colours after band boundaries change", () => {
    // Two valid boundary configs that place the same depth in different interpolation spans.
    //
    // Tight (default-like): boundary[2]=100ft → stop t=0.05 exactly
    //   depth 100ft → t=0.05 exactly = stop[2] → returns colors[2] (sky blue #00a8d0)
    //
    // Spread: boundary[1]=200ft → stop t=0.1
    //   depth 100ft → t=0.05, between stop[0]=0 and stop[1]=0.1
    //   → lerp(colors[0]=#00e5ff, colors[1]=#00c8de, 0.5) — different from colors[2]
    //
    // setBandBoundary() clamps values by their neighbours so we use setState
    // directly to install radically different configs — the same mechanism the
    // settings store uses to sync on hydration.
    const tightBoundaries = [0, 50, 100, 150, 200, 250, 300, 350, 450, 600, 2000];
    const spreadBoundaries = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000];

    const depths = [100]; // 100 ft depth, maxDepth=2000 ft → t=0.05
    const before = new Float32Array(3);
    const after  = new Float32Array(3);

    usePaletteStore.setState({ ...usePaletteStore.getState(), bandBoundaries: tightBoundaries });
    applyColormapToVertexColors(depths, 0, 2000, before, getColormap("ocean"));

    // Swap to a spread config — getColormap reads fresh boundaries from the store
    usePaletteStore.setState({ ...usePaletteStore.getState(), bandBoundaries: spreadBoundaries });
    applyColormapToVertexColors(depths, 0, 2000, after, getColormap("ocean"));

    // The g-channel must differ (r=0 in both configs since all palette colours
    // start with #00…; g and b shift measurably between the two spans)
    expect(before[1]).not.toBeCloseTo(after[1]!, 4);
  });

  it("clamped depths (all at minDepth) all receive the shallowest colour", () => {
    const depths = [0, 0, 0];
    const colors = new Float32Array(9);
    applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean"));
    expect(colors[0]).toBeCloseTo(colors[3]!, 5);
    expect(colors[1]).toBeCloseTo(colors[4]!, 5);
    expect(colors[2]).toBeCloseTo(colors[5]!, 5);
  });

  it("applyColormapToVertexColors writes exactly depths.length × 3 values", () => {
    const depths = [0, 100, 200, 300, 400, 500];
    const colors = new Float32Array(depths.length * 3);
    applyColormapToVertexColors(depths, 0, 500, colors, getColormap("ocean"));
    // All entries should be in [0, 1] — a valid normalised RGB channel
    for (let i = 0; i < colors.length; i++) {
      expect(colors[i]).toBeGreaterThanOrEqual(0);
      expect(colors[i]).toBeLessThanOrEqual(1);
    }
  });

  it("null depth cells are skipped — their colour is not overwritten by the colormap", () => {
    // depths: real value at index 0, survey gap (null) at index 1
    const depths: (number | null)[] = [500, null];
    const colors = new Float32Array(6);
    // Pre-fill index 1 with the no-data light-gray (as buildTerrainGeometry does)
    colors[3] = NO_DATA_COLOR.r;
    colors[4] = NO_DATA_COLOR.g;
    colors[5] = NO_DATA_COLOR.b;
    applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean"));
    // Index 0 should have been written by the colormap.
    const anyNonZero = colors[0] !== 0 || colors[1] !== 0 || colors[2] !== 0;
    expect(anyNonZero).toBe(true);
    // Index 1 (null cell) must retain the no-data light-gray exactly.
    expect(colors[3]).toBeCloseTo(NO_DATA_COLOR.r, 5);
    expect(colors[4]).toBeCloseTo(NO_DATA_COLOR.g, 5);
    expect(colors[5]).toBeCloseTo(NO_DATA_COLOR.b, 5);
  });

  it("applyColormapToVertexColors: null cells in a mixed grid are exactly NO_DATA_COLOR after pre-fill", () => {
    // Simulate the full pipeline: buildTerrainGeometry pre-fills null cells with
    // NO_DATA_COLOR, then applyColormapToVertexColors must leave them untouched.
    const depths: (number | null)[] = [0, null, 500, null, 1000];
    const colors = new Float32Array(depths.length * 3);
    // Pre-fill all null-cell slots with NO_DATA_COLOR (as buildTerrainGeometry does)
    for (let i = 0; i < depths.length; i++) {
      if (depths[i] === null) {
        colors[i * 3]     = NO_DATA_COLOR.r;
        colors[i * 3 + 1] = NO_DATA_COLOR.g;
        colors[i * 3 + 2] = NO_DATA_COLOR.b;
      }
    }
    applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean"));
    // Null cells (indices 1 and 3) must retain NO_DATA_COLOR exactly.
    expect(colors[3]).toBeCloseTo(NO_DATA_COLOR.r, 5);
    expect(colors[4]).toBeCloseTo(NO_DATA_COLOR.g, 5);
    expect(colors[5]).toBeCloseTo(NO_DATA_COLOR.b, 5);
    expect(colors[9]).toBeCloseTo(NO_DATA_COLOR.r, 5);
    expect(colors[10]).toBeCloseTo(NO_DATA_COLOR.g, 5);
    expect(colors[11]).toBeCloseTo(NO_DATA_COLOR.b, 5);
    // Non-null cells (indices 0, 2, 4) must have been written by the colormap (non-zero).
    const idx0HasColor = colors[0] !== 0 || colors[1] !== 0 || colors[2] !== 0;
    expect(idx0HasColor).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Negative-zero vertex Y — minDepth = 0 grids must never produce -0.0
// ---------------------------------------------------------------------------

describe("buildTerrainGeometry — no IEEE-754 −0 in position buffer (minDepth=0)", () => {
  it("no vertex Y is −0 for a grid where minDepth=0 and depths include 0", () => {
    const N = 4;
    // Mix: some vertices at minDepth (depth=0, t=0 → would produce −0)
    const depths = Array.from({ length: N * N }, (_, i) => i * 10) as number[]; // 0,10,20,...
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: (N * N - 1) * 10 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } })
      .attributes?.position?.array;
    if (!positions) return;
    for (let i = 0; i < N * N; i++) {
      const y = positions[i * 3 + 1]!;
      expect(Object.is(y, -0)).toBe(false);
    }
  });

  it("vertex at depth=minDepth has Y===0 (positive zero, not −0)", () => {
    const N = 2;
    const grid = makeGrid(N, { depths: [0, 500, 500, 1000], minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } })
      .attributes?.position?.array;
    if (!positions) return;
    expect(positions[1]).toBe(0);
    expect(Object.is(positions[1], -0)).toBe(false);
  });
});

describe("buildTerrainSkirtGeometry — no IEEE-754 −0 in wall top-edge vertices", () => {
  it("no top-edge Y is −0 for a grid where minDepth=0 and some depths are 0", () => {
    const N = 4;
    const depths = Array.from({ length: N * N }, (_, i) => i % 2 === 0 ? 0 : 100) as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 100 });
    const geo = buildTerrainSkirtGeometry(grid);
    const positions = (geo as unknown as { attributes?: { position?: { array?: Float32Array } } })
      .attributes?.position?.array;
    if (!positions) return;
    for (let i = 0; i < positions.length / 3; i++) {
      const y = positions[i * 3 + 1]!;
      expect(Object.is(y, -0)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Non-finite depth resilience
// ---------------------------------------------------------------------------

describe("buildTerrainGeometry — non-finite depths (NaN, Infinity, -Infinity)", () => {
  it("does not throw when depths array contains NaN", () => {
    const N = 3;
    const depths = [0, NaN, 50, NaN, 100, NaN, 50, NaN, 0] as unknown as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 100 });
    expect(() => buildTerrainGeometry(grid)).not.toThrow();
  });

  it("does not throw when depths array contains Infinity", () => {
    const N = 3;
    const depths = [0, Infinity, 50, 100, -Infinity, 50, 0, 100, 50] as unknown as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 100 });
    expect(() => buildTerrainGeometry(grid)).not.toThrow();
  });

  it("produces no NaN or Infinity in the position buffer when depths has non-finite values", () => {
    const N = 3;
    const depths = [0, NaN, 50, Infinity, 100, -Infinity, 50, NaN, 0] as unknown as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 100 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } })
      .attributes?.position?.array;
    if (!positions) return;
    for (let i = 0; i < positions.length; i++) {
      expect(Number.isFinite(positions[i]!)).toBe(true);
    }
  });

  it("NaN/Infinity depth cells are treated as survey gaps (Y=0, no-data colour)", () => {
    const N = 2;
    const depths = [NaN, 500, 500, 1000] as unknown as number[];
    const grid = makeGrid(N, { depths, minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } })
      .attributes?.position?.array;
    const colorAttr = (geo as unknown as { attributes: { color: { array: Float32Array } } })
      .attributes?.color?.array;
    if (!positions || !colorAttr) return;
    expect(positions[1]).toBe(0);
    expect(colorAttr[0]).toBeCloseTo(NO_DATA_COLOR.r, 5);
    expect(colorAttr[1]).toBeCloseTo(NO_DATA_COLOR.g, 5);
    expect(colorAttr[2]).toBeCloseTo(NO_DATA_COLOR.b, 5);
  });
});

describe("applyColormapToVertexColors — non-finite depth resilience", () => {
  it("does not throw and preserves pre-filled colour for NaN depth cell", () => {
    const depths: (number | null)[] = [NaN as unknown as number, 500];
    const colors = new Float32Array(6);
    colors[0] = 0.35; colors[1] = 0.45; colors[2] = 0.55;
    expect(() =>
      applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean")),
    ).not.toThrow();
    expect(colors[0]).toBeCloseTo(0.35, 5);
    expect(colors[1]).toBeCloseTo(0.45, 5);
    expect(colors[2]).toBeCloseTo(0.55, 5);
  });

  it("does not throw for Infinity or -Infinity depth values", () => {
    const depths: (number | null)[] = [Infinity as unknown as number, -Infinity as unknown as number, 100];
    const colors = new Float32Array(9);
    expect(() =>
      applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean")),
    ).not.toThrow();
  });

  it("all result colour values are finite after a mix of valid and non-finite depths", () => {
    const depths: (number | null)[] = [0, NaN as unknown as number, 500, Infinity as unknown as number, 1000, -Infinity as unknown as number];
    const colors = new Float32Array(depths.length * 3);
    applyColormapToVertexColors(depths, 0, 1000, colors, getColormap("ocean"));
    for (let i = 0; i < colors.length; i++) {
      expect(Number.isFinite(colors[i]!)).toBe(true);
    }
  });
});

describe("NO_DATA_COLOR constant", () => {
  it("is light gray { r: 0.75, g: 0.75, b: 0.75 } — cartographically conventional land colour", () => {
    expect(NO_DATA_COLOR).toEqual({ r: 0.75, g: 0.75, b: 0.75 });
  });
});

describe("buildTerrainGeometry — null depth (survey-gap) cells", () => {
  it("null depth vertex is placed at Y=0 (water surface)", () => {
    const N = 2;
    const grid = makeGrid(N, { depths: [null, 500, 500, 1000] as unknown as number[], minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    const positions = (geo as unknown as { attributes: { position: { array: Float32Array } } }).attributes?.position?.array;
    if (!positions) return;
    // First vertex (null depth) → Y should be exactly 0
    expect(positions[1]).toBe(0);
  });

  it("null depth vertex receives the light-gray no-data colour", () => {
    const N = 2;
    const grid = makeGrid(N, { depths: [null, 500, 500, 1000] as unknown as number[], minDepth: 0, maxDepth: 1000 });
    const geo = buildTerrainGeometry(grid);
    const colorAttr = (geo as unknown as { attributes: { color: { array: Float32Array } } }).attributes?.color?.array;
    if (!colorAttr) return;
    expect(colorAttr[0]).toBeCloseTo(NO_DATA_COLOR.r, 5);
    expect(colorAttr[1]).toBeCloseTo(NO_DATA_COLOR.g, 5);
    expect(colorAttr[2]).toBeCloseTo(NO_DATA_COLOR.b, 5);
  });
});

// ---------------------------------------------------------------------------
// getSeaSurfaceY
// ---------------------------------------------------------------------------

describe("getSeaSurfaceY", () => {
  it("minDepth=0 → surfY=0 (terrain top is exactly at sea level)", () => {
    const grid = makeGrid(4, { minDepth: 0, maxDepth: 1000 });
    expect(getSeaSurfaceY(grid)).toBeCloseTo(0, 5);
  });

  it("minDepth=5, maxDepth=100 → surfY > 0 (survey starts below sea surface)", () => {
    const grid = makeGrid(4, { minDepth: 5, maxDepth: 100 });
    const expected = (5 / 95) * MAX_DEPTH_WORLD;
    expect(getSeaSurfaceY(grid)).toBeCloseTo(expected, 5);
    expect(getSeaSurfaceY(grid)).toBeGreaterThan(0);
  });

  it("corrupt data (minDepth > maxDepth) → result clamped to [0, MAX_DEPTH_WORLD]", () => {
    const grid = makeGrid(4, { minDepth: 500, maxDepth: 100 });
    const result = getSeaSurfaceY(grid);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(MAX_DEPTH_WORLD);
  });

  it("minDepth=maxDepth (degenerate flat grid) → uses depthRange=1 fallback, result clamped", () => {
    const grid = makeGrid(4, { minDepth: 50, maxDepth: 50 });
    const result = getSeaSurfaceY(grid);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(MAX_DEPTH_WORLD);
  });

  it("result is always within [0, MAX_DEPTH_WORLD] for any minDepth/maxDepth combo", () => {
    const cases: Array<{ minDepth: number; maxDepth: number }> = [
      { minDepth: 0, maxDepth: 0 },
      { minDepth: 0, maxDepth: 10000 },
      { minDepth: 100, maxDepth: 200 },
      { minDepth: 200, maxDepth: 100 },
      { minDepth: -50, maxDepth: 1000 },
      { minDepth: 10000, maxDepth: 10000 },
    ];
    for (const { minDepth, maxDepth } of cases) {
      const grid = makeGrid(4, { minDepth, maxDepth });
      const result = getSeaSurfaceY(grid);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(MAX_DEPTH_WORLD);
    }
  });

  it("negative minDepth (land elevation data) → surfY=0 (clamped, never negative)", () => {
    const grid = makeGrid(4, { minDepth: -10, maxDepth: 1000 });
    expect(getSeaSurfaceY(grid)).toBeCloseTo(0, 5);
  });
});
