/**
 * overviewRenderer.nodata.test.ts
 *
 * Verifies that `buildHeatmapBitmap` marks no-data (null-depth) pixels as fully
 * transparent (alpha = 0) so that when multiple datasets are drawn on top of each
 * other, a later-drawn dataset's real depth pixels are never obscured by an
 * earlier dataset's gap/padding region.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { buildHeatmapBitmap } from "../overviewRenderer";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// paletteStore is read at module init inside buildHeatmapBitmap for band-fill
// tinting. Preserve all real exports (DEFAULT_BAND_COLORS etc. are re-exported
// to colormap.ts) and only override the Zustand store accessor.
vi.mock("../paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../paletteStore")>();
  return {
    ...actual,
    usePaletteStore: {
      ...actual.usePaletteStore,
      getState: () => ({ bandColors: [], bandBoundaries: [] }),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the smallest valid TerrainData grid accepted by buildHeatmapBitmap.
 * `depths` must have length w × h.  Null entries represent no-data cells.
 */
function makeGrid(
  w: number,
  h: number,
  depths: (number | null)[],
  opts: Partial<Pick<TerrainData, "minDepth" | "maxDepth" | "minLon" | "maxLon" | "minLat" | "maxLat">> = {},
): TerrainData {
  return {
    width: w,
    height: h,
    resolution: w,
    depths,
    minDepth: opts.minDepth ?? 0,
    maxDepth: opts.maxDepth ?? 100,
    minLon:   opts.minLon   ?? -10,
    maxLon:   opts.maxLon   ?? 10,
    minLat:   opts.minLat   ?? -10,
    maxLat:   opts.maxLat   ?? 10,
    datasetId: "test",
    waterType: "saltwater",
  } as unknown as TerrainData;
}

/**
 * Call `buildHeatmapBitmap` with a controlled canvas stub that captures the
 * ImageData object after `buildHeatmapBitmap` has finished writing to it.
 *
 * Returns the captured ImageData (same reference that `putImageData` received).
 */
function captureImageData(grid: TerrainData): Uint8ClampedArray {
  const W = grid.width;
  const H = grid.height;
  const pixelData = new Uint8ClampedArray(W * H * 4);
  const fakeImageData = { data: pixelData, width: W, height: H } as ImageData;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementationOnce(
    function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        createImageData: vi.fn(() => fakeImageData),
        putImageData: vi.fn(),
        // These are accessed during no-op paths but not exercised here:
        fillRect: vi.fn(),
        clearRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D;
    },
  );

  buildHeatmapBitmap(grid, "ocean");
  return pixelData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildHeatmapBitmap — nodata pixel transparency", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("no-data cells produce alpha = 0 (fully transparent)", () => {
    // 2 × 2 grid:
    //   data row 0: [10, 20]  — real depth
    //   data row 1: [null, null] — no-data
    //
    // After Y-flip (canvas row 0 = northernmost = data row H-1):
    //   canvas row 0 → data row 1 → both pixels are no-data → alpha must be 0
    //   canvas row 1 → data row 0 → both pixels are real depth → alpha must be 255
    const grid = makeGrid(2, 2, [10, 20, null, null]);
    const data = captureImageData(grid);

    // Canvas pixel (col=0, row=0): pixelIdx=0, i=0 → maps to data[1*2+0]=null
    expect(data[3]).toBe(0);   // alpha of canvas pixel (0,0)
    // Canvas pixel (col=1, row=0): pixelIdx=1, i=4 → maps to data[1*2+1]=null
    expect(data[7]).toBe(0);   // alpha of canvas pixel (1,0)

    // Canvas pixel (col=0, row=1): pixelIdx=2, i=8 → maps to data[0*2+0]=10
    expect(data[11]).toBe(255); // alpha of canvas pixel (0,1)
    // Canvas pixel (col=1, row=1): pixelIdx=3, i=12 → maps to data[0*2+1]=20
    expect(data[15]).toBe(255); // alpha of canvas pixel (1,1)
  });

  it("real-depth cells are always fully opaque (alpha = 255)", () => {
    // All cells have valid depths — no pixel may be transparent.
    const depths = Array.from({ length: 9 }, (_, i) => 10 + i * 5); // 10…50 m
    const grid = makeGrid(3, 3, depths);
    const data = captureImageData(grid);

    for (let px = 0; px < 9; px++) {
      expect(data[px * 4 + 3]).toBe(255);
    }
  });

  it("entirely no-data grid produces all-zero alpha values", () => {
    const grid = makeGrid(3, 3, new Array(9).fill(null));
    const data = captureImageData(grid);

    for (let px = 0; px < 9; px++) {
      expect(data[px * 4 + 3]).toBe(0);
    }
  });

  it("land cells (topography > 0) produce alpha = 0 (fully transparent)", () => {
    // 2 × 2 grid:
    //   data row 0: [10, 20]  — real depth
    //   data row 1: [5, 8]    — also real depth, but above-water land per topography
    //
    // After Y-flip (canvas row 0 = northernmost = data row H-1):
    //   canvas row 0 → data row 1 → land cells → alpha must be 0
    //   canvas row 1 → data row 0 → depth cells → alpha must be 255
    const grid = makeGrid(2, 2, [10, 20, 5, 8]);
    // topography[dataIdx]: positive = land (above-water elevation).
    // dataIdx for (row=1, col=0) = 1*2+0 = 2; (row=1, col=1) = 3
    const topography = [0, 0, 10, 15]; // data row 1 cells are land

    const W = grid.width;
    const H = grid.height;
    const pixelData = new Uint8ClampedArray(W * H * 4);
    const fakeImageData = { data: pixelData, width: W, height: H } as ImageData;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementationOnce(
      function (this: HTMLCanvasElement) {
        return {
          canvas: this,
          createImageData: vi.fn(() => fakeImageData),
          putImageData: vi.fn(),
          fillRect: vi.fn(),
          clearRect: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      },
    );

    buildHeatmapBitmap(grid, "ocean", topography);

    // Canvas row 0 → data row 1 (land cells) → alpha = 0
    expect(pixelData[3]).toBe(0);  // canvas pixel (col=0, row=0)
    expect(pixelData[7]).toBe(0);  // canvas pixel (col=1, row=0)

    // Canvas row 1 → data row 0 (real depth cells) → alpha = 255
    expect(pixelData[11]).toBe(255); // canvas pixel (col=0, row=1)
    expect(pixelData[15]).toBe(255); // canvas pixel (col=1, row=1)
  });

  it("land cells never occlude a second dataset's real depth pixels", () => {
    // Dataset A: 2 × 2 grid — data row 0 is real depth, data row 1 is land.
    // After Y-flip: canvas row 0 = land (alpha=0), canvas row 1 = depth (alpha=255).
    const gridA = makeGrid(2, 2, [10, 20, 5, 8]);
    const topographyA = [0, 0, 10, 15]; // data row 1 = land

    const W = 2, H = 2;
    const pixelDataA = new Uint8ClampedArray(W * H * 4);
    const fakeImageDataA = { data: pixelDataA, width: W, height: H } as ImageData;

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementationOnce(
      function (this: HTMLCanvasElement) {
        return {
          canvas: this,
          createImageData: vi.fn(() => fakeImageDataA),
          putImageData: vi.fn(),
          fillRect: vi.fn(),
          clearRect: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      },
    );

    buildHeatmapBitmap(gridA, "ocean", topographyA);

    // Dataset B (no topography): entirely real depth.
    const gridB = makeGrid(2, 2, [30, 40, 50, 60]);
    const pixelDataB = captureImageData(gridB);

    // A's land cells must be transparent.
    expect(pixelDataA[3]).toBe(0);  // (col=0, row=0) = land → transparent
    expect(pixelDataA[7]).toBe(0);  // (col=1, row=0) = land → transparent

    // B's pixels must be opaque.
    for (let px = 0; px < 4; px++) {
      expect(pixelDataB[px * 4 + 3]).toBe(255);
    }

    // Simulate source-over compositing: draw A then B over A's top row (the land row).
    // Because A's land pixels have alpha=0, B's pixels show through unchanged.
    for (let px = 0; px < 2; px++) {
      const aIdx = px * 4;
      const bIdx = px * 4;
      const aA = pixelDataA[aIdx + 3]! / 255; // 0 for land cells
      const bA = pixelDataB[bIdx + 3]! / 255; // 1 for real depth
      const outA = bA + aA * (1 - bA);
      expect(Math.round(outA * 255)).toBe(255); // result is opaque
    }
  });

  it("overlap scenario: A's no-data region cannot occlude B's real pixels", () => {
    // Dataset A: 4 × 4 grid, entirely no-data (simulates the outer survey whose
    // bbox fully contains dataset B).  With alpha = 0, source-over compositing
    // leaves whatever was previously drawn at those positions intact.
    const gridA = makeGrid(4, 4, new Array(16).fill(null));

    // Dataset B: 2 × 2 grid, all real-depth pixels (the inner survey).
    const gridB = makeGrid(2, 2, [10, 20, 30, 40]);

    const dataA = captureImageData(gridA);
    const dataB = captureImageData(gridB);

    // Every pixel of A must be transparent so it cannot paint over B.
    for (let px = 0; px < 16; px++) {
      expect(dataA[px * 4 + 3]).toBe(
        0,
        `Dataset A pixel ${px} should have alpha=0 (no-data) but got ${dataA[px * 4 + 3]}`,
      );
    }

    // Every pixel of B must be opaque — real depth data is never transparent.
    for (let px = 0; px < 4; px++) {
      expect(dataB[px * 4 + 3]).toBe(
        255,
        `Dataset B pixel ${px} should have alpha=255 (real data) but got ${dataB[px * 4 + 3]}`,
      );
    }

    // Simulate canvas source-over compositing (standard 2D Canvas default):
    // composite[i+3] = srcA + dstA × (1 − srcA/255)
    // When srcA (dataset A) = 0, composite[i+3] = dstA (dataset B).
    // So dataset B's pixels survive unchanged after drawing A then B.
    const composite = new Uint8ClampedArray(4 * 4 * 4); // 4×4 pixels × 4 channels
    // Draw A first
    for (let i = 0; i < composite.length; i += 4) {
      const aAlpha = dataA[i + 3]! / 255;
      composite[i]     = Math.round(dataA[i]!     * aAlpha);
      composite[i + 1] = Math.round(dataA[i + 1]! * aAlpha);
      composite[i + 2] = Math.round(dataA[i + 2]! * aAlpha);
      composite[i + 3] = Math.round(aAlpha * 255);
    }
    // Draw B over the top-left 2×2 region (source-over)
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const bIdx = (py * 2 + px) * 4;
        const cIdx = (py * 4 + px) * 4; // B overlaps top-left of A's canvas
        const bA   = dataB[bIdx + 3]! / 255;
        const cA   = composite[cIdx + 3]! / 255;
        const outA = bA + cA * (1 - bA);
        const blendCh = (b: number, c: number): number =>
          outA > 0 ? Math.round((b * bA + c * cA * (1 - bA)) / outA) : 0;
        composite[cIdx]     = blendCh(dataB[bIdx]!,     composite[cIdx]!);
        composite[cIdx + 1] = blendCh(dataB[bIdx + 1]!, composite[cIdx + 1]!);
        composite[cIdx + 2] = blendCh(dataB[bIdx + 2]!, composite[cIdx + 2]!);
        composite[cIdx + 3] = Math.round(outA * 255);
      }
    }

    // After compositing, the 2×2 B region must be fully opaque and match B's
    // pixel data (since A contributed nothing — alpha 0).
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const bIdx = (py * 2 + px) * 4;
        const cIdx = (py * 4 + px) * 4;
        expect(composite[cIdx + 3]).toBe(255); // opaque after B is drawn
        expect(composite[cIdx]).toBe(dataB[bIdx]!);
        expect(composite[cIdx + 1]).toBe(dataB[bIdx + 1]!);
        expect(composite[cIdx + 2]).toBe(dataB[bIdx + 2]!);
      }
    }
  });
});
