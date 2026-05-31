import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("three", () => {
  class Color {
    r: number;
    g: number;
    b: number;
    constructor(hex?: string) {
      if (hex) {
        const n = parseInt(hex.replace("#", ""), 16);
        this.r = ((n >> 16) & 0xff) / 255;
        this.g = ((n >> 8) & 0xff) / 255;
        this.b = (n & 0xff) / 255;
      } else {
        this.r = 0;
        this.g = 0;
        this.b = 0;
      }
    }
    clone() {
      const c = new Color();
      c.r = this.r;
      c.g = this.g;
      c.b = this.b;
      return c;
    }
    convertLinearToSRGB() {
      return this;
    }
    lerpColors(a: Color, b: Color, alpha: number) {
      this.r = a.r + (b.r - a.r) * alpha;
      this.g = a.g + (b.g - a.g) * alpha;
      this.b = a.b + (b.b - a.b) * alpha;
      return this;
    }
  }
  return { Color };
});

import type { TerrainData } from "@workspace/api-client-react";
import { buildHeatmapBitmap } from "../lib/overviewRenderer";
import { usePaletteStore } from "../lib/paletteStore";

function makeGrid(
  overrides: Partial<TerrainData> = {},
): TerrainData {
  const W = 4;
  const H = 4;
  const depths: number[] = [];
  for (let i = 0; i < W * H; i++) {
    depths.push(i * 10);
  }
  return {
    width: W,
    height: H,
    depths,
    minDepth: 0,
    maxDepth: 150,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
    datasetId: "test",
    ...overrides,
  } as TerrainData;
}

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

describe("buildHeatmapBitmap — colormap theme", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("produces different first-pixel colour for 'thermal' vs 'ocean' with the same grid", () => {
    const grid = makeGrid();

    const { capturedImageDatas: oceanData, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean");
    spy1.mockRestore();

    const { capturedImageDatas: thermalData, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "thermal");
    spy2.mockRestore();

    expect(oceanData.length).toBe(1);
    expect(thermalData.length).toBe(1);

    const ocean = oceanData[0]!;
    const thermal = thermalData[0]!;

    const totalDiff =
      Math.abs(ocean[0]! - thermal[0]!) +
      Math.abs(ocean[1]! - thermal[1]!) +
      Math.abs(ocean[2]! - thermal[2]!);

    expect(totalDiff).toBeGreaterThan(5);
  });

  it("defaults to 'ocean' theme when no theme argument is supplied", () => {
    const grid = makeGrid();

    const { capturedImageDatas: defaultData, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid);
    spy1.mockRestore();

    const { capturedImageDatas: oceanData, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean");
    spy2.mockRestore();

    const def = defaultData[0]!;
    const ocean = oceanData[0]!;

    expect(def[0]).toBe(ocean[0]);
    expect(def[1]).toBe(ocean[1]);
    expect(def[2]).toBe(ocean[2]);
  });

  it("produces different output for 'viridis' vs 'grayscale'", () => {
    const grid = makeGrid();

    const { capturedImageDatas: viridisData, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "viridis");
    spy1.mockRestore();

    const { capturedImageDatas: grayData, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "grayscale");
    spy2.mockRestore();

    const viridis = viridisData[0]!;
    const gray = grayData[0]!;

    const totalDiff =
      Math.abs(viridis[0]! - gray[0]!) +
      Math.abs(viridis[1]! - gray[1]!) +
      Math.abs(viridis[2]! - gray[2]!);

    expect(totalDiff).toBeGreaterThan(5);
  });
});
