import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OverviewTransform } from "../lib/overviewRenderer";

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
import {
  buildHeatmapBitmap,
  lonLatToCanvas,
  canvasToLonLat,
} from "../lib/overviewRenderer";
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

// ---------------------------------------------------------------------------
// Coordinate conversion — orientation correctness
// ---------------------------------------------------------------------------

function makeTransform(overrides: Partial<OverviewTransform> = {}): OverviewTransform {
  return {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    pxPerDeg: 100,
    ...overrides,
  };
}

describe("lonLatToCanvas — North-up orientation", () => {
  const grid = makeGrid({
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
  });
  const t = makeTransform({ pxPerDeg: 200 });

  it("higher latitude maps to a smaller Y value (North-up)", () => {
    const [, ySouth] = lonLatToCanvas(-119.5, 47.0, grid, t);
    const [, yNorth] = lonLatToCanvas(-119.5, 48.0, grid, t);
    expect(yNorth).toBeLessThan(ySouth);
  });

  it("the southernmost latitude maps to the bottom of the terrain (largest Y)", () => {
    const [, yMin] = lonLatToCanvas(-119.5, grid.minLat, grid, t);
    const [, yMax] = lonLatToCanvas(-119.5, grid.maxLat, grid, t);
    expect(yMin).toBeGreaterThan(yMax);
  });

  it("the northernmost latitude maps to offsetY (top edge)", () => {
    const [, yTop] = lonLatToCanvas(-119.5, grid.maxLat, grid, t);
    expect(yTop).toBeCloseTo(t.offsetY, 5);
  });

  it("the southernmost latitude maps to offsetY + terrainH (bottom edge)", () => {
    const latRange = grid.maxLat - grid.minLat;
    const terrainH = t.pxPerDeg * latRange * t.scale;
    const [, yBottom] = lonLatToCanvas(-119.5, grid.minLat, grid, t);
    expect(yBottom).toBeCloseTo(t.offsetY + terrainH, 5);
  });

  it("longitude increases → X increases (West to East)", () => {
    const [xWest] = lonLatToCanvas(-120.0, 47.5, grid, t);
    const [xEast] = lonLatToCanvas(-119.0, 47.5, grid, t);
    expect(xEast).toBeGreaterThan(xWest);
  });

  it("a mid-latitude maps to the vertical midpoint of the terrain", () => {
    const midLat = (grid.minLat + grid.maxLat) / 2;
    const latRange = grid.maxLat - grid.minLat;
    const terrainH = t.pxPerDeg * latRange * t.scale;
    const [, yMid] = lonLatToCanvas(-119.5, midLat, grid, t);
    expect(yMid).toBeCloseTo(t.offsetY + terrainH / 2, 5);
  });

  it("respects offsetX and offsetY from the transform", () => {
    const shifted = makeTransform({ pxPerDeg: 200, offsetX: 50, offsetY: 30 });
    const [x, y] = lonLatToCanvas(grid.minLon, grid.maxLat, grid, shifted);
    expect(x).toBeCloseTo(50, 5);
    expect(y).toBeCloseTo(30, 5);
  });

  it("scale doubles the terrain size proportionally", () => {
    const t1 = makeTransform({ pxPerDeg: 100, scale: 1 });
    const t2 = makeTransform({ pxPerDeg: 100, scale: 2 });
    const [, y1] = lonLatToCanvas(-119.5, grid.minLat, grid, t1);
    const [, y2] = lonLatToCanvas(-119.5, grid.minLat, grid, t2);
    expect(y2).toBeCloseTo(y1 * 2, 5);
  });
});

describe("canvasToLonLat — round-trip fidelity", () => {
  const grid = makeGrid({
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
  });
  const t = makeTransform({ pxPerDeg: 200 });

  it("round-trips a point at the centre of the grid", () => {
    const lon = -119.5;
    const lat = 47.5;
    const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);
    const { lon: lon2, lat: lat2 } = canvasToLonLat(cx, cy, grid, t);
    expect(lon2).toBeCloseTo(lon, 8);
    expect(lat2).toBeCloseTo(lat, 8);
  });

  it("round-trips the SW corner (minLon, minLat)", () => {
    const [cx, cy] = lonLatToCanvas(grid.minLon, grid.minLat, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(grid.minLon, 8);
    expect(lat).toBeCloseTo(grid.minLat, 8);
  });

  it("round-trips the NE corner (maxLon, maxLat)", () => {
    const [cx, cy] = lonLatToCanvas(grid.maxLon, grid.maxLat, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(grid.maxLon, 8);
    expect(lat).toBeCloseTo(grid.maxLat, 8);
  });

  it("round-trips the NW corner (minLon, maxLat)", () => {
    const [cx, cy] = lonLatToCanvas(grid.minLon, grid.maxLat, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(grid.minLon, 8);
    expect(lat).toBeCloseTo(grid.maxLat, 8);
  });

  it("round-trips an arbitrary interior point", () => {
    const lon = -119.73;
    const lat = 47.21;
    const [cx, cy] = lonLatToCanvas(lon, lat, grid, t);
    const { lon: lon2, lat: lat2 } = canvasToLonLat(cx, cy, grid, t);
    expect(lon2).toBeCloseTo(lon, 8);
    expect(lat2).toBeCloseTo(lat, 8);
  });

  it("round-trips correctly with non-zero offsetX / offsetY", () => {
    const shifted = makeTransform({ pxPerDeg: 200, offsetX: 40, offsetY: 25 });
    const lon = -119.9;
    const lat = 47.8;
    const [cx, cy] = lonLatToCanvas(lon, lat, grid, shifted);
    const { lon: lon2, lat: lat2 } = canvasToLonLat(cx, cy, grid, shifted);
    expect(lon2).toBeCloseTo(lon, 8);
    expect(lat2).toBeCloseTo(lat, 8);
  });

  it("round-trips correctly at scale > 1", () => {
    const zoomed = makeTransform({ pxPerDeg: 200, scale: 3 });
    const lon = -119.6;
    const lat = 47.4;
    const [cx, cy] = lonLatToCanvas(lon, lat, grid, zoomed);
    const { lon: lon2, lat: lat2 } = canvasToLonLat(cx, cy, grid, zoomed);
    expect(lon2).toBeCloseTo(lon, 8);
    expect(lat2).toBeCloseTo(lat, 8);
  });
});

describe("buildHeatmapBitmap — northernmost data row in top canvas row", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("top canvas row (row 0) encodes the deepest data row when depths increase southward", () => {
    // H=2, W=2 grid: depths are stored [southRow, northRow] internally.
    // depths[0..1] = 0 (south, shallow), depths[2..3] = 100 (north, deep).
    // buildHeatmapBitmap flips Y: canvas row 0 reads depths[(H-1-0)*W+col] = depths[2..3] = 100.
    // Canvas row 1 reads depths[(H-1-1)*W+col] = depths[0..1] = 0.
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 100, 100],
      minDepth: 0,
      maxDepth: 100,
    });

    let topRowPixels: Uint8ClampedArray | undefined;
    let bottomRowPixels: Uint8ClampedArray | undefined;

    const mockCtx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray; width: number; height: number }) => {
        const W = imageData.width;
        topRowPixels = new Uint8ClampedArray(imageData.data.buffer, 0, W * 4);
        bottomRowPixels = new Uint8ClampedArray(imageData.data.buffer, W * 4, W * 4);
      }),
    };

    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    buildHeatmapBitmap(grid, "grayscale");
    spy.mockRestore();

    expect(topRowPixels).toBeDefined();
    expect(bottomRowPixels).toBeDefined();

    // Grayscale: deeper (t=1) → brighter; shallow (t=0) → darker.
    // Top row (northernmost, depth=100, t=1) must be brighter than bottom row (depth=0, t=0).
    const topBrightness = topRowPixels![0]!;
    const bottomBrightness = bottomRowPixels![0]!;
    expect(topBrightness).toBeGreaterThan(bottomBrightness);
  });

  it("bottom canvas row encodes the southernmost (shallowest) data when depths increase northward", () => {
    // Reversed: south=deep (100), north=shallow (0).
    // Canvas row 0 (top/north) reads depths[(H-1)*W+col] = depths[0..1] = 100 (deep).
    // Canvas row 1 (bottom/south) reads depths[0*W+col] = depths[2..3] = 0 (shallow).
    // Wait — depths[0] is the first row in the array. Convention: data row 0 is south.
    // depths = [100, 100, 0, 0]: row0=south=100 (deep), row1=north=0 (shallow).
    // canvas row 0 (north) → (H-1-0)*W = row1 → 0 (shallow) → darker.
    // canvas row 1 (south) → (H-1-1)*W = row0 → 100 (deep) → brighter.
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [100, 100, 0, 0],
      minDepth: 0,
      maxDepth: 100,
    });

    let topRowPixels: Uint8ClampedArray | undefined;
    let bottomRowPixels: Uint8ClampedArray | undefined;

    const mockCtx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray; width: number; height: number }) => {
        const W = imageData.width;
        topRowPixels = new Uint8ClampedArray(imageData.data.buffer, 0, W * 4);
        bottomRowPixels = new Uint8ClampedArray(imageData.data.buffer, W * 4, W * 4);
      }),
    };

    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    buildHeatmapBitmap(grid, "grayscale");
    spy.mockRestore();

    expect(topRowPixels).toBeDefined();
    expect(bottomRowPixels).toBeDefined();

    // Top canvas row = north = shallow (t=0) → darker in grayscale.
    // Bottom canvas row = south = deep (t=1) → brighter in grayscale.
    const topBrightness = topRowPixels![0]!;
    const bottomBrightness = bottomRowPixels![0]!;
    expect(bottomBrightness).toBeGreaterThan(topBrightness);
  });

  it("uniform depth grid produces identical pixel colours across all rows", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [50, 50, 50, 50],
      minDepth: 0,
      maxDepth: 100,
    });

    let capturedData: Uint8ClampedArray | undefined;

    const mockCtx = {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: vi.fn((imageData: { data: Uint8ClampedArray }) => {
        capturedData = new Uint8ClampedArray(imageData.data);
      }),
    };

    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return { width: 0, height: 0, getContext: () => mockCtx } as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    buildHeatmapBitmap(grid, "grayscale");
    spy.mockRestore();

    expect(capturedData).toBeDefined();
    const r0 = capturedData![0]!;
    for (let i = 0; i < 4 * 2 * 2; i += 4) {
      expect(capturedData![i]).toBe(r0);
    }
  });
});
