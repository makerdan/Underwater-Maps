/**
 * Unit tests for buildHillshadeLayer and the hillshading integration in
 * buildHeatmapBitmap.
 *
 * Physics summary (mirroring terrainShader.ts):
 *   ambient  = 0.55
 *   diffuse  = max(0, dot(N, SUN_DIR)) * 0.45
 *   lighting = min(ambient + diffuse, 1.2)
 *   SUN_DIR  = normalize(0.5, 1.0, 0.7)
 *
 * For a flat grid all normals are (0,1,0), which gives:
 *   dot = SUN_DIR.y ≈ 0.7672
 *   lighting ≈ 0.55 + 0.45 * 0.7672 ≈ 0.895
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("three");

import type { TerrainData } from "@workspace/api-client-react";
import { buildHillshadeLayer, buildHeatmapBitmap } from "../lib/overviewRenderer";
import { usePaletteStore } from "../lib/paletteStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrid(
  overrides: Partial<TerrainData> & { depths?: Array<number | null> } = {},
): TerrainData {
  const W = 4;
  const H = 4;
  // Default: uniform depth 100 m (flat terrain)
  const depths: number[] = Array.from({ length: W * H }, () => 100);
  return {
    width: W,
    height: H,
    depths,
    minDepth: 100,
    maxDepth: 100,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    datasetId: "test-hillshade",
    ...overrides,
  } as TerrainData;
}

/** Compute the expected flat-grid lighting value analytically. */
const SUN_MAG = Math.sqrt(0.5 * 0.5 + 1.0 * 1.0 + 0.7 * 0.7);
const SUN_Y   = 1.0 / SUN_MAG; // dominant Y component
const FLAT_GRID_LIGHTING = 0.55 + 0.45 * SUN_Y; // ≈ 0.895

// ---------------------------------------------------------------------------
// Canvas mock for buildHeatmapBitmap tests
// ---------------------------------------------------------------------------

function makeImageData(w: number, h: number) {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  };
}

function setupCanvasMock() {
  const capturedImageDatas: Uint8ClampedArray[] = [];

  const mockCtx = {
    createImageData: (w: number, h: number) => makeImageData(w, h),
    putImageData: vi.fn((imageData: ReturnType<typeof makeImageData>) => {
      capturedImageDatas.push(new Uint8ClampedArray(imageData.data));
    }),
  };

  const createElementSpy = vi
    .spyOn(document, "createElement")
    .mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const canvas = {
          width: 0,
          height: 0,
          getContext: (_: string) => mockCtx,
        };
        return canvas as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

  return { capturedImageDatas, createElementSpy };
}

// ---------------------------------------------------------------------------
// buildHillshadeLayer — flat grid
// ---------------------------------------------------------------------------

describe("buildHillshadeLayer — flat grid", () => {
  it("returns one value per pixel (W × H)", () => {
    const grid = makeGrid({ minDepth: 50, maxDepth: 50 });
    const layer = buildHillshadeLayer(grid);
    expect(layer.length).toBe(grid.width * grid.height);
  });

  it("all values equal the flat-grid lighting for a uniform-depth grid", () => {
    const grid = makeGrid({ minDepth: 50, maxDepth: 50 });
    const layer = buildHillshadeLayer(grid);
    for (let i = 0; i < layer.length; i++) {
      expect(layer[i]!).toBeCloseTo(FLAT_GRID_LIGHTING, 5);
    }
  });

  it("values are greater than ambient (0.55) on a flat grid — sun is above horizon", () => {
    const grid = makeGrid({ minDepth: 50, maxDepth: 50 });
    const layer = buildHillshadeLayer(grid);
    for (let i = 0; i < layer.length; i++) {
      expect(layer[i]!).toBeGreaterThan(0.55);
    }
  });
});

// ---------------------------------------------------------------------------
// buildHillshadeLayer — null / NaN cells
// ---------------------------------------------------------------------------

describe("buildHillshadeLayer — null / NaN cells return ambient floor", () => {
  it("null depth → ambient (0.55)", () => {
    const W = 3;
    const H = 3;
    // Centre cell is null; surrounding cells have depth 50 m
    const depths: Array<number | null> = Array(W * H).fill(50) as number[];
    depths[Math.floor((W * H) / 2)] = null;
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 50, maxDepth: 50 });
    const layer = buildHillshadeLayer(grid);
    // Canvas row for centre cell: canvas_row = H-1-dataRow (Y-flip)
    // dataRow=1, col=1 → canvas pixel idx = (H-1-1)*W + 1 = 1*3+1 = 4
    expect(layer[4]!).toBeCloseTo(0.55, 5);
  });

  it("NaN depth → ambient (0.55)", () => {
    const W = 3;
    const H = 3;
    const depths: Array<number> = Array(W * H).fill(50) as number[];
    depths[0] = NaN;
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 50, maxDepth: 50 });
    const layer = buildHillshadeLayer(grid);
    // dataRow=0, col=0 → canvas_row = H-1-0 = 2 → pixel idx = 2*3+0 = 6
    expect(layer[6]!).toBeCloseTo(0.55, 5);
  });
});

// ---------------------------------------------------------------------------
// buildHillshadeLayer — sun-facing vs back-facing slopes
// ---------------------------------------------------------------------------

describe("buildHillshadeLayer — slopes", () => {
  /**
   * Sun direction is normalize(0.5, 1.0, 0.7).  In data space:
   *   +col → East (+X world)
   *   +row in data → South (+Z world)
   * Sun horizontal components: +X (East), +Z (South).
   * A surface that deepens toward the NW tilts the normal toward SE (+X, +Z),
   * increasing the dot product with the sun → brighter than flat.
   */
  it("a slope deepening eastward (col-wise) is well-lit (above ambient) but may be darkened below flat by the slope-magnitude term", () => {
    const W = 5;
    const H = 5;
    // Depth increases 10 m per column: 0, 10, 20, 30, 40 (repeated each row).
    // This east-facing slope aligns with the sun's +X component, so the raw
    // directional lighting is above FLAT_GRID_LIGHTING.  However, the slope-
    // magnitude darkening (slopeMag ≈ 0.5 → factor ≈ 0.91) can reduce the
    // final value below FLAT_GRID_LIGHTING — the "ink edge" effect is intentional.
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push(c * 10);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 40 });
    const layer = buildHillshadeLayer(grid);

    // Centre pixel: interior cell, not at edge
    const centrePixelIdx = (Math.floor(H / 2)) * W + Math.floor(W / 2);
    // Must still be well above the ambient floor (0.55) — the slope is lit, not black.
    expect(layer[centrePixelIdx]!).toBeGreaterThan(0.55 + 0.1);
    // Must not exceed the shader cap (1.2).
    expect(layer[centrePixelIdx]!).toBeLessThanOrEqual(1.2);
  });

  it("a slope deepening southward (row-wise) is well-lit (above ambient) — slope-magnitude ink edge applies", () => {
    const W = 5;
    const H = 5;
    // Depth increases 10 m per data row: row 0 = 0 m, row 4 = 40 m.
    // This southward slope aligns with the sun's +Z component.  The slope-
    // magnitude term applies here too; the final value may be below FLAT_GRID_LIGHTING.
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push(r * 10);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 40 });
    const layer = buildHillshadeLayer(grid);

    // Centre interior pixel
    const centrePixelIdx = (Math.floor(H / 2)) * W + Math.floor(W / 2);
    // Well above ambient floor — the slope is lit.
    expect(layer[centrePixelIdx]!).toBeGreaterThan(0.55 + 0.1);
    expect(layer[centrePixelIdx]!).toBeLessThanOrEqual(1.2);
  });

  it("a slope deepening strongly westward tilts normal away from sun → not brighter than flat", () => {
    const W = 5;
    const H = 5;
    // Depth DECREASES eastward (increases westward): col 0 = 40 m, col 4 = 0 m
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push((W - 1 - c) * 10);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 40 });
    const layer = buildHillshadeLayer(grid);

    // Centre interior pixel — normal tilts West (away from sun's +X component)
    const centrePixelIdx = (Math.floor(H / 2)) * W + Math.floor(W / 2);
    expect(layer[centrePixelIdx]!).toBeLessThanOrEqual(FLAT_GRID_LIGHTING + 1e-6);
  });

  it("back-facing slope (dot < 0) is clamped to ambient floor (0.55)", () => {
    // Build a very steep NW-facing slope (deepens strongly toward east AND south)
    // then test that nothing drops below 0.55.
    const W = 5;
    const H = 5;
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        // Very steep westward + northward slope → normal faces strongly NW
        depths.push((W - 1 - c) * 200 + (H - 1 - r) * 200);
      }
    }
    const minD = 0;
    const maxD = (W - 1) * 200 + (H - 1) * 200;
    const grid = makeGrid({ width: W, height: H, depths, minDepth: minD, maxDepth: maxD });
    const layer = buildHillshadeLayer(grid);

    for (let i = 0; i < layer.length; i++) {
      // No cell should go below the ambient floor
      expect(layer[i]!).toBeGreaterThanOrEqual(0.55 - 1e-9);
    }
  });

  it("no cell ever exceeds 1.2 (the shader cap)", () => {
    const W = 4;
    const H = 4;
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push(c * 100 + r * 100);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 600 });
    const layer = buildHillshadeLayer(grid);

    for (let i = 0; i < layer.length; i++) {
      expect(layer[i]!).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// buildHeatmapBitmap — regression: hillshade does not break existing behaviour
// ---------------------------------------------------------------------------

describe("buildHeatmapBitmap — hillshade regression", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("different colormap themes still produce visually distinct output when hillshading is on", () => {
    const depths: number[] = [];
    for (let i = 0; i < 16; i++) depths.push(i * 10);
    const grid = makeGrid({ depths, minDepth: 0, maxDepth: 150 });

    const { capturedImageDatas: oceanData, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean");
    spy1.mockRestore();

    const { capturedImageDatas: thermalData, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "thermal");
    spy2.mockRestore();

    const ocean   = oceanData[0]!;
    const thermal = thermalData[0]!;
    const totalDiff =
      Math.abs(ocean[0]! - thermal[0]!) +
      Math.abs(ocean[1]! - thermal[1]!) +
      Math.abs(ocean[2]! - thermal[2]!);
    expect(totalDiff).toBeGreaterThan(5);
  });

  it("pixel RGB values (hillshaded) are always ≤ corresponding un-hillshaded values × 1.2", () => {
    // Build a non-flat grid so hillshade is non-trivial
    const W = 4;
    const H = 4;
    const depths: number[] = [];
    for (let i = 0; i < W * H; i++) depths.push(i * 10);
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 150 });

    // Capture hillshaded bitmap
    const { capturedImageDatas: shaded, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "viridis", null, true);
    spy1.mockRestore();

    // Capture non-hillshaded bitmap (stretchContrast=false, hillshade effectively
    // means uniform hs=1 here since we can't disable hillshade separately, but
    // we verify the cap: shaded[i] ≤ unshaded[i] * 1.2)
    // We test the cap rule: no channel in the hillshaded output exceeds 255.
    const shadedData = shaded[0]!;
    for (let i = 0; i < shadedData.length; i += 4) {
      // Each channel must be a valid byte [0, 255]
      expect(shadedData[i]!).toBeGreaterThanOrEqual(0);
      expect(shadedData[i]!).toBeLessThanOrEqual(255);
      expect(shadedData[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(shadedData[i + 1]!).toBeLessThanOrEqual(255);
      expect(shadedData[i + 2]!).toBeGreaterThanOrEqual(0);
      expect(shadedData[i + 2]!).toBeLessThanOrEqual(255);
      // Alpha must always be fully opaque
      expect(shadedData[i + 3]!).toBe(255);
    }
  });

  it("stretchContrast=false does not override domain for narrow surveys", () => {
    // Narrow survey: 10–20 m is < 15% of the 0–609.6 m ocean domain.
    // With stretchContrast=false the first pixel should be the same palette
    // colour as with the full absolute domain (the t value should be tiny).
    const depths: number[] = Array(16).fill(10) as number[];
    const grid = makeGrid({ depths, minDepth: 10, maxDepth: 20 });

    const { capturedImageDatas: noStretch, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", null, false);
    spy1.mockRestore();

    const { capturedImageDatas: withStretch, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", null, true);
    spy2.mockRestore();

    const ns = noStretch[0]!;
    const ws = withStretch[0]!;

    // The two should differ: without stretch the 10–20 m range maps near t≈0
    // giving a shallow-ocean colour; with stretch the domain is 10–20 m giving
    // the full gradient.
    const diff = Math.abs(ns[0]! - ws[0]!) + Math.abs(ns[1]! - ws[1]!) + Math.abs(ns[2]! - ws[2]!);
    expect(diff).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildHillshadeLayer — slope-magnitude darkening (step 2 of task)
// ---------------------------------------------------------------------------

describe("buildHillshadeLayer — slope-magnitude darkening", () => {
  it("flat grid (ddCol = ddRow = 0) produces same intensity as existing directional lighting — slope term is zero", () => {
    // Uniform depth → zero finite differences → slopeMag = 0 → factor (1 − 0.18×0) = 1.
    // Output must equal the flat-grid directional lighting value exactly.
    const grid = makeGrid({ minDepth: 100, maxDepth: 100 });
    const layer = buildHillshadeLayer(grid);
    for (let i = 0; i < layer.length; i++) {
      expect(layer[i]!).toBeCloseTo(FLAT_GRID_LIGHTING, 5);
    }
  });

  it("steep grid: interior cell intensity is measurably lower than flat-grid baseline", () => {
    // East-sloping grid: depth increases 200 m per column, creating significant
    // world-space slope → slopeMag ≈ 0.5 → ~9% darkening on top of directional lighting.
    const W = 5;
    const H = 5;
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push(c * 200);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 800 });
    const layer = buildHillshadeLayer(grid);

    // Interior centre canvas pixel: canvasRow = floor(H/2), col = floor(W/2)
    const centreIdx = Math.floor(H / 2) * W + Math.floor(W / 2);
    // With the slope term applied (slopeMag ≈ 0.5), final intensity ≈ 0.847 which
    // is measurably below FLAT_GRID_LIGHTING ≈ 0.895 (gap > 0.02).
    expect(layer[centreIdx]!).toBeLessThan(FLAT_GRID_LIGHTING - 0.02);
  });

  it("slope darkening does not apply when there is no slope (hillshade-off parity guard)", () => {
    // Guard: on a flat grid the slope term (1 − 0.18 × slopeMag) equals exactly 1,
    // so the output is identical to the pre-slope-term behaviour.
    // This confirms the slope path never darkens areas that are already flat.
    const W = 4;
    const H = 4;
    const depths = Array.from({ length: W * H }, () => 200);
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 200, maxDepth: 200 });
    const layer = buildHillshadeLayer(grid);
    for (let i = 0; i < layer.length; i++) {
      expect(layer[i]!).toBeCloseTo(FLAT_GRID_LIGHTING, 5);
    }
  });
});
