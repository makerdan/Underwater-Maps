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

  it("renders visibly different colors for 5 m vs 120 m depth on the ocean theme", () => {
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
