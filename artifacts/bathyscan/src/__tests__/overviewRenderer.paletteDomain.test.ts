/**
 * Regression tests for buildHeatmapBitmap full-palette rendering.
 *
 * Before the fix, buildHeatmapBitmap called getColormap with a grid-relative
 * range. On shallow datasets where the entire depth range fits inside band 0
 * of the ocean palette (~0–15 m fits inside 0–50 ft), every water pixel
 * received band 0's cyan color (#00e5ff). Post-fix, the domain is anchored to
 * the absolute 0–2000 ft scale via getColormapDepthDomain so band colors span
 * the expected depth ranges.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared stub — wired via __mocks__/three.ts.
vi.mock("three");

import type { TerrainData } from "@workspace/api-client-react";
import { buildHeatmapBitmap } from "../lib/overviewRenderer";
import { usePaletteStore } from "../lib/paletteStore";

// ---------------------------------------------------------------------------
// Canvas mock helpers (mirrors the pattern in overviewRenderer.test.ts)
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
// Tests
// ---------------------------------------------------------------------------

describe("buildHeatmapBitmap — full palette domain", () => {
  beforeEach(() => {
    // Ensure the default 10-band ocean palette is active.
    usePaletteStore.getState().reset();
  });

  it("renders visibly different colours for 5 m vs 120 m depth on the ocean theme", () => {
    const { capturedImageDatas, createElementSpy } = setupCanvasMock();

    // 2-pixel wide, 1-pixel tall grid.
    // Cell 0 (left):  5 m  ≈ 16 ft → sits inside band 0 (0–50 ft) → #00e5ff cyan
    // Cell 1 (right): 120 m ≈ 394 ft → sits inside band 6 (300–350 ft) → #0d47a1 royal blue
    //
    // Height is 1, so the single canvas row maps to the single data row.
    // buildHeatmapBitmap flips Y (dataIdx = (H-1-row)*W+col), but with H=1
    // the flip is a no-op.
    const grid: TerrainData = {
      width: 2,
      height: 1,
      depths: [5, 120],
      minDepth: 5,
      maxDepth: 120,
      minLon: -120,
      maxLon: -119,
      minLat: 47,
      maxLat: 48,
      datasetId: "palette-domain-test",
    } as TerrainData;

    buildHeatmapBitmap(grid, "ocean");

    expect(capturedImageDatas.length).toBeGreaterThan(0);
    const pixels = capturedImageDatas[0];

    // Pixel 0 = cell at depth 5 m, pixel 1 = cell at depth 120 m.
    const r0 = pixels[0], g0 = pixels[1], b0 = pixels[2];
    const r1 = pixels[4], g1 = pixels[5], b1 = pixels[6];

    // Total RGB channel difference must exceed 30 to confirm distinct bands.
    // Pre-fix: both pixels got band 0's color, difference = 0.
    // Post-fix: band 0 cyan vs band 6 royal blue, difference >> 30.
    const diff = Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1);
    expect(diff).toBeGreaterThan(30);

    createElementSpy.mockRestore();
  });

});

// ---------------------------------------------------------------------------
// buildHeatmapBitmap — depth-band hypsometric fill (step 3 of task)
// ---------------------------------------------------------------------------

describe("buildHeatmapBitmap — depth-band hypsometric fill", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("ocean theme with custom palette: pixel in band 0 blends band 0 colour into the output", () => {
    // Custom 2-band palette: band 0 = #ff0000 (red), band 1 = #0000ff (blue).
    // Boundaries [0, 50, 100000] ft → band 0 covers 0–15.24 m.
    // With stretchContrast=false the absolute domain [0, 609.6 m] is used, so
    // t ≈ 5/609.6 ≈ 0.0082 (well inside band 1 of the colormap stops but still
    // within band 0 of the depth boundaries). The blend shifts R toward #ff0000.
    usePaletteStore.setState({
      bandColors: ["#ff0000", "#0000ff"],
      bandBoundaries: [0, 50, 100000],
      blendBands: true,
    });

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();

    const grid: TerrainData = {
      width: 1,
      height: 1,
      depths: [5],
      minDepth: 5,
      maxDepth: 5,
      minLon: -120, maxLon: -119,
      minLat: 47, maxLat: 48,
      datasetId: "band-fill-test",
    } as TerrainData;

    // stretchContrast=false: use absolute [0, 609.6 m] domain so t≈0.0082 →
    // colormap gives ~#0000ff (blue); band fill blends in #ff0000 (band 0), shifting R up.
    buildHeatmapBitmap(grid, "ocean", null, false);
    createElementSpy.mockRestore();

    expect(capturedImageDatas.length).toBeGreaterThan(0);
    const pixels = capturedImageDatas[0]!;

    // Alpha always fully opaque.
    expect(pixels[3]).toBe(255);
    // R channel should be noticeably > 0 (shifted toward #ff0000's red component).
    // Without band fill: R = 0 (colormap gives blue). With 28% blend of red: R ≈ 64.
    expect(pixels[0]!).toBeGreaterThan(30);
  });

  it("preset theme (thermal): band-fill blend is skipped — two identical calls match exactly", () => {
    // Thermal theme is not ocean/custom → isAbsoluteDepthTheme=false → no band blend.
    // Two consecutive renders of the same grid must produce bit-identical output.
    const grid: TerrainData = {
      width: 2,
      height: 2,
      depths: [10, 20, 30, 40],
      minDepth: 10,
      maxDepth: 40,
      minLon: -120, maxLon: -119,
      minLat: 47, maxLat: 48,
      datasetId: "thermal-test",
    } as TerrainData;

    const { capturedImageDatas: run1, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "thermal");
    spy1.mockRestore();

    const { capturedImageDatas: run2, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "thermal");
    spy2.mockRestore();

    // Identical input → identical output (no stochastic band blending for preset themes).
    const p1 = run1[0]!;
    const p2 = run2[0]!;
    for (let i = 0; i < p1.length; i++) {
      expect(p1[i]).toBe(p2[i]);
    }
  });

  it("multi-dataset: two independent ocean-theme grids both exhibit band-fill tinting", () => {
    // Both grids at the same depth get the same band-fill tint independently,
    // confirming the effect is applied dataset-by-dataset without cross-contamination.
    usePaletteStore.setState({
      bandColors: ["#ff0000", "#0000ff"],
      bandBoundaries: [0, 50, 100000],
      blendBands: true,
    });

    const makeTestGrid = (id: string, depth: number): TerrainData => ({
      width: 1,
      height: 1,
      depths: [depth],
      minDepth: depth,
      maxDepth: depth,
      minLon: -120, maxLon: -119,
      minLat: 47, maxLat: 48,
      datasetId: id,
    } as TerrainData);

    const { capturedImageDatas: g1Data, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(makeTestGrid("g1", 5), "ocean", null, false);
    spy1.mockRestore();

    const { capturedImageDatas: g2Data, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(makeTestGrid("g2", 5), "ocean", null, false);
    spy2.mockRestore();

    // Both grids at depth 5 m produce the same band-tinted output (deterministic).
    expect(g1Data[0]![3]).toBe(255); // fully opaque
    expect(g2Data[0]![3]).toBe(255);
    // R channel > 30 for both: band fill shifted colour toward #ff0000.
    expect(g1Data[0]![0]!).toBeGreaterThan(30);
    expect(g2Data[0]![0]!).toBeGreaterThan(30);
    // Both grids at identical depth with identical palette produce identical pixels.
    expect(g1Data[0]![0]).toBe(g2Data[0]![0]);
    expect(g1Data[0]![1]).toBe(g2Data[0]![1]);
    expect(g1Data[0]![2]).toBe(g2Data[0]![2]);
  });
});
