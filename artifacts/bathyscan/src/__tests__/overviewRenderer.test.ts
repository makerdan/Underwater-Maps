import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OverviewTransform } from "../lib/overviewRenderer";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

import type { TerrainData, EfhFeature } from "@workspace/api-client-react";
import { EfhFeatureType } from "@workspace/api-client-react";
import {
  buildHeatmapBitmap,
  buildContourLines,
  MAX_CONTOUR_SEGMENTS,
  lonLatToCanvas,
  canvasToLonLat,
  renderViewCone,
  renderEfhOverlay,
  renderIntertidalBand,
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

// ---------------------------------------------------------------------------
// Antimeridian-crossing bounding boxes
// ---------------------------------------------------------------------------

describe("lonLatToCanvas — antimeridian-crossing bbox (minLon=170, maxLon=-170)", () => {
  // 20° span centred on the antimeridian: 170 → 180 → -180 → -170
  const grid = makeGrid({
    minLon: 170,
    maxLon: -170,
    minLat: 50,
    maxLat: 60,
  });
  // pxPerDeg=100, so terrainW = 100 * 20 * 1 = 2000 px
  const t = makeTransform({ pxPerDeg: 100 });

  it("the west edge (minLon=170) maps to offsetX", () => {
    const [x] = lonLatToCanvas(170, 55, grid, t);
    expect(x).toBeCloseTo(t.offsetX, 5);
  });

  it("the east edge (maxLon=-170) maps to offsetX + terrainW", () => {
    const [x] = lonLatToCanvas(-170, 55, grid, t);
    const terrainW = t.pxPerDeg * 20 * t.scale;
    expect(x).toBeCloseTo(t.offsetX + terrainW, 5);
  });

  it("a point just east of the antimeridian (-175°) maps between 50% and 100% of terrainW", () => {
    // -175 normalises to 185; fraction = (185-170)/20 = 0.75
    const [x] = lonLatToCanvas(-175, 55, grid, t);
    const terrainW = t.pxPerDeg * 20 * t.scale;
    expect(x).toBeCloseTo(t.offsetX + 0.75 * terrainW, 5);
  });

  it("a point just west of the antimeridian (175°) maps between 0% and 50% of terrainW", () => {
    // 175 is already >= minLon; fraction = (175-170)/20 = 0.25
    const [x] = lonLatToCanvas(175, 55, grid, t);
    const terrainW = t.pxPerDeg * 20 * t.scale;
    expect(x).toBeCloseTo(t.offsetX + 0.25 * terrainW, 5);
  });

  it("points east of antimeridian have greater X than points west of antimeridian", () => {
    const [xWest] = lonLatToCanvas(175, 55, grid, t);
    const [xEast] = lonLatToCanvas(-175, 55, grid, t);
    expect(xEast).toBeGreaterThan(xWest);
  });
});

describe("canvasToLonLat — round-trip fidelity with antimeridian-crossing bbox", () => {
  const grid = makeGrid({
    minLon: 170,
    maxLon: -170,
    minLat: 50,
    maxLat: 60,
  });
  const t = makeTransform({ pxPerDeg: 100 });

  it("round-trips a point west of the antimeridian (175°)", () => {
    const [cx, cy] = lonLatToCanvas(175, 55, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(175, 8);
    expect(lat).toBeCloseTo(55, 8);
  });

  it("round-trips a point east of the antimeridian (-175°)", () => {
    const [cx, cy] = lonLatToCanvas(-175, 55, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(-175, 8);
    expect(lat).toBeCloseTo(55, 8);
  });

  it("round-trips the west edge (minLon=170)", () => {
    const [cx, cy] = lonLatToCanvas(170, 55, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(170, 8);
    expect(lat).toBeCloseTo(55, 8);
  });

  it("round-trips the east edge (maxLon=-170)", () => {
    const [cx, cy] = lonLatToCanvas(-170, 55, grid, t);
    const { lon, lat } = canvasToLonLat(cx, cy, grid, t);
    expect(lon).toBeCloseTo(-170, 8);
    expect(lat).toBeCloseTo(55, 8);
  });

  it("round-trips with non-zero offsets and scale > 1", () => {
    const zoomed = makeTransform({ pxPerDeg: 100, scale: 2, offsetX: 30, offsetY: 20 });
    const lon = -173;
    const lat = 57.5;
    const [cx, cy] = lonLatToCanvas(lon, lat, grid, zoomed);
    const { lon: lon2, lat: lat2 } = canvasToLonLat(cx, cy, grid, zoomed);
    expect(lon2).toBeCloseTo(lon, 8);
    expect(lat2).toBeCloseTo(lat, 8);
  });
});

// ---------------------------------------------------------------------------
// Shared ctx mock for renderer tests
// ---------------------------------------------------------------------------

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fillText: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    shadowColor: "",
    shadowBlur: 0,
    lineWidth: 1,
    font: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    measureText: vi.fn(() => ({ width: 50 })),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// renderViewCone — North-up coordinate placement + cone geometry
// ---------------------------------------------------------------------------

describe("renderViewCone — North-up coordinate placement", () => {
  const grid = makeGrid({ minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 });
  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });
  const latRange = grid.maxLat - grid.minLat;
  const lonRange = grid.maxLon - grid.minLon;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const terrainW = t.pxPerDeg * lonRange * t.scale;
  const ALT = 20;
  const FOV = 60;

  it("camera at the northern edge (maxLat) translates to Y ≈ offsetY — not the bottom", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, -119.5, grid.maxLat, 180, ALT, FOV, grid, t);
    const [, cy] = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(cy).toBeCloseTo(t.offsetY, 3);
  });

  it("camera at the southern edge (minLat) translates to Y ≈ offsetY + terrainH — not the top", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, -119.5, grid.minLat, 180, ALT, FOV, grid, t);
    const [, cy] = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(cy).toBeCloseTo(t.offsetY + terrainH, 3);
  });

  it("northern camera Y is strictly less than southern camera Y (North-up)", () => {
    const ctxN = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxN, -119.5, grid.maxLat, 180, ALT, FOV, grid, t);
    const [, cyN] = (ctxN.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];

    const ctxS = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxS, -119.5, grid.minLat, 180, ALT, FOV, grid, t);
    const [, cyS] = (ctxS.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];

    expect(cyN).toBeLessThan(cyS);
  });

  it("camera at the western edge (minLon) translates to X ≈ offsetX (left edge)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, grid.minLon, 47.5, 180, ALT, FOV, grid, t);
    const [cx] = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(cx).toBeCloseTo(t.offsetX, 3);
  });

  it("camera at the eastern edge (maxLon) translates to X ≈ offsetX + terrainW (right edge)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, grid.maxLon, 47.5, 180, ALT, FOV, grid, t);
    const [cx] = (ctx.translate as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(cx).toBeCloseTo(t.offsetX + terrainW, 3);
  });

  it("heading 180° (North-facing) produces rotate angle ≈ 0 rad", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, -119.5, 47.5, 180, ALT, FOV, grid, t);
    const [rad] = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls[0] as [number];
    expect(rad).toBeCloseTo(0, 5);
  });

  it("heading 0° (South-facing) produces rotate angle ≈ π rad", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, -119.5, 47.5, 0, ALT, FOV, grid, t);
    const [rad] = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls[0] as [number];
    expect(rad).toBeCloseTo(Math.PI, 5);
  });

  it("heading 90° (East-facing) produces rotate angle ≈ π/2 rad", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctx, -119.5, 47.5, 90, ALT, FOV, grid, t);
    const [rad] = (ctx.rotate as ReturnType<typeof vi.fn>).mock.calls[0] as [number];
    expect(rad).toBeCloseTo(Math.PI / 2, 5);
  });

  it("higher altitude produces a longer cone than low altitude", () => {
    const ctxLow = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxLow, -119.5, 47.5, 180, 1, FOV, grid, t);
    const lowLineTo = (ctxLow.lineTo as ReturnType<typeof vi.fn>).mock.calls;

    const ctxHigh = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxHigh, -119.5, 47.5, 180, 70, FOV, grid, t);
    const highLineTo = (ctxHigh.lineTo as ReturnType<typeof vi.fn>).mock.calls;

    // The first lineTo call gives the left edge of the cone; Y is negative
    // (forward / up on canvas before heading rotation). Greater |Y| → longer cone.
    const [, lowY] = lowLineTo[0] as [number, number];
    const [, highY] = highLineTo[0] as [number, number];
    expect(Math.abs(highY)).toBeGreaterThan(Math.abs(lowY));
  });

  it("wider FOV produces a wider cone spread", () => {
    const ctxNarrow = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxNarrow, -119.5, 47.5, 180, ALT, 30, grid, t);
    const narrowLineTo = (ctxNarrow.lineTo as ReturnType<typeof vi.fn>).mock.calls;

    const ctxWide = makeCtx() as unknown as CanvasRenderingContext2D;
    renderViewCone(ctxWide, -119.5, 47.5, 180, ALT, 90, grid, t);
    const wideLineTo = (ctxWide.lineTo as ReturnType<typeof vi.fn>).mock.calls;

    // Left edge X is negative; wider FOV → more negative X → larger |X|.
    const [narrowX] = narrowLineTo[0] as [number, number];
    const [wideX] = wideLineTo[0] as [number, number];
    expect(Math.abs(wideX)).toBeGreaterThan(Math.abs(narrowX));
  });
});

// ---------------------------------------------------------------------------
// lonLatToCanvas — coordinate placement for SVG marker layer
// ---------------------------------------------------------------------------

describe("lonLatToCanvas — coordinate placement for SVG marker layer", () => {
  const grid = makeGrid({ minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 });
  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });
  const latRange = grid.maxLat - grid.minLat;
  const lonRange = grid.maxLon - grid.minLon;
  const terrainH = t.pxPerDeg * latRange * t.scale;
  const terrainW = t.pxPerDeg * lonRange * t.scale;

  it("a northern marker maps to a smaller Y than a southern marker (North-up)", () => {
    const [, cyN] = lonLatToCanvas(-119.5, grid.maxLat, grid, t);
    const [, cyS] = lonLatToCanvas(-119.5, grid.minLat, grid, t);
    expect(cyN).toBeLessThan(cyS);
  });

  it("a marker at maxLat maps to Y ≈ offsetY (top edge)", () => {
    const [, cy] = lonLatToCanvas(-119.5, grid.maxLat, grid, t);
    expect(cy).toBeCloseTo(t.offsetY, 3);
  });

  it("a marker at minLat maps to Y ≈ offsetY + terrainH (bottom edge)", () => {
    const [, cy] = lonLatToCanvas(-119.5, grid.minLat, grid, t);
    expect(cy).toBeCloseTo(t.offsetY + terrainH, 3);
  });

  it("an eastern marker has greater X than a western marker (West-to-East left-to-right)", () => {
    const [cxW] = lonLatToCanvas(grid.minLon, 47.5, grid, t);
    const [cxE] = lonLatToCanvas(grid.maxLon, 47.5, grid, t);
    expect(cxE).toBeGreaterThan(cxW);
  });

  it("a marker at minLon maps to X ≈ offsetX (left edge)", () => {
    const [cx] = lonLatToCanvas(grid.minLon, 47.5, grid, t);
    expect(cx).toBeCloseTo(t.offsetX, 3);
  });

  it("a marker at maxLon maps to X ≈ offsetX + terrainW (right edge)", () => {
    const [cx] = lonLatToCanvas(grid.maxLon, 47.5, grid, t);
    expect(cx).toBeCloseTo(t.offsetX + terrainW, 3);
  });

  it("a marker far outside the terrain bbox maps to an X far from the canvas (SVG inCanvas() gates rendering)", () => {
    const [cx] = lonLatToCanvas(0, 47.5, grid, t);
    // lon=0 is far east of maxLon=-119, so cx should be far to the right
    expect(cx).toBeGreaterThan(t.offsetX + terrainW + 1000);
  });

  it("two in-bounds markers at different longitudes produce distinct X coordinates", () => {
    const [cx1] = lonLatToCanvas(-119.8, 47.5, grid, t);
    const [cx2] = lonLatToCanvas(-119.2, 47.5, grid, t);
    expect(cx2).toBeGreaterThan(cx1);
  });
});

// ---------------------------------------------------------------------------
// renderEfhOverlay — coordinate placement and hidden-species gate
// ---------------------------------------------------------------------------

describe("renderEfhOverlay — coordinate placement and hidden-species gate", () => {
  const grid = makeGrid({ minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 });
  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });
  const latRange = grid.maxLat - grid.minLat;
  const terrainH = t.pxPerDeg * latRange * t.scale;

  function makePolygonFeature(
    ring: [number, number][],
    commonName: string,
    color = "#00e5ff",
  ): EfhFeature {
    return {
      type: EfhFeatureType.Feature,
      properties: {
        species: "test_species",
        commonName,
        fmp: "Test FMP",
        depthRangeM: [0, 100],
        habitatDescription: "Test",
        source: "test",
        creditUrl: "https://example.com",
        color,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring.map(([lon, lat]) => [lon, lat])],
      },
    };
  }

  it("polygon at the northern edge produces moveTo with Y ≈ offsetY (top)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const feature = makePolygonFeature(
      [[-119.5, grid.maxLat], [-119.4, grid.maxLat], [-119.4, grid.maxLat - 0.1], [-119.5, grid.maxLat]],
      "Pollock",
    );
    renderEfhOverlay(ctx, [feature], grid, t);
    const moveCalls = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls;
    expect(moveCalls.length).toBeGreaterThan(0);
    const [, firstY] = moveCalls[0] as [number, number];
    expect(firstY).toBeCloseTo(t.offsetY, 3);
  });

  it("polygon at the southern edge produces moveTo with Y ≈ offsetY + terrainH (bottom)", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const feature = makePolygonFeature(
      [[-119.5, grid.minLat], [-119.4, grid.minLat], [-119.4, grid.minLat + 0.1], [-119.5, grid.minLat]],
      "Rockfish",
    );
    renderEfhOverlay(ctx, [feature], grid, t);
    const moveCalls = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls;
    expect(moveCalls.length).toBeGreaterThan(0);
    const [, firstY] = moveCalls[0] as [number, number];
    expect(firstY).toBeCloseTo(t.offsetY + terrainH, 3);
  });

  it("northern polygon vertices have smaller Y than southern polygon vertices (North-up)", () => {
    const ctxN = makeCtx() as unknown as CanvasRenderingContext2D;
    renderEfhOverlay(ctxN, [makePolygonFeature(
      [[-119.5, grid.maxLat], [-119.4, grid.maxLat], [-119.4, grid.maxLat - 0.05], [-119.5, grid.maxLat]],
      "Pollock",
    )], grid, t);
    const [, northY] = (ctxN.moveTo as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];

    const ctxS = makeCtx() as unknown as CanvasRenderingContext2D;
    renderEfhOverlay(ctxS, [makePolygonFeature(
      [[-119.5, grid.minLat], [-119.4, grid.minLat], [-119.4, grid.minLat + 0.05], [-119.5, grid.minLat]],
      "Rockfish",
    )], grid, t);
    const [, southY] = (ctxS.moveTo as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];

    expect(northY).toBeLessThan(southY);
  });

  it("hidden species are skipped — moveTo is never called for a fully-hidden feature", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const feature = makePolygonFeature(
      [[-119.5, 47.5], [-119.4, 47.5], [-119.4, 47.6], [-119.5, 47.5]],
      "Halibut",
    );
    renderEfhOverlay(ctx, [feature], grid, t, new Set(["Halibut"]));
    expect((ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("visible species are drawn even when another species is hidden", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    const visible = makePolygonFeature(
      [[-119.5, 47.5], [-119.4, 47.5], [-119.4, 47.6], [-119.5, 47.5]],
      "Pollock",
    );
    const hidden = makePolygonFeature(
      [[-119.5, 47.7], [-119.4, 47.7], [-119.4, 47.8], [-119.5, 47.7]],
      "Halibut",
    );
    renderEfhOverlay(ctx, [visible, hidden], grid, t, new Set(["Halibut"]));
    expect((ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("two visible features each produce a separate beginPath call", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderEfhOverlay(ctx, [
      makePolygonFeature(
        [[-119.5, 47.5], [-119.4, 47.5], [-119.4, 47.6], [-119.5, 47.5]],
        "Pollock",
      ),
      makePolygonFeature(
        [[-119.9, 47.2], [-119.8, 47.2], [-119.8, 47.3], [-119.9, 47.2]],
        "Rockfish",
      ),
    ], grid, t);
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("empty features array draws nothing — beginPath is never called", () => {
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderEfhOverlay(ctx, [], grid, t);
    expect((ctx.beginPath as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildHeatmapBitmap — northernmost data row in top canvas row
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildContourLines — marching-squares geometry
// ---------------------------------------------------------------------------

describe("buildContourLines — edge cases and degenerate grids", () => {
  it("returns empty array for a 1×1 grid (too small for marching squares)", () => {
    const grid = makeGrid({ width: 1, height: 1, depths: [50], minDepth: 0, maxDepth: 100 });
    expect(buildContourLines(grid, 10)).toEqual([]);
  });

  it("returns empty array when intervalMetres is zero", () => {
    const grid = makeGrid();
    expect(buildContourLines(grid, 0)).toEqual([]);
  });

  it("returns empty array when intervalMetres is negative", () => {
    const grid = makeGrid();
    expect(buildContourLines(grid, -5)).toEqual([]);
  });

  it("returns empty array when all depths are identical (no iso-level crossing)", () => {
    const grid = makeGrid({
      width: 3,
      height: 3,
      depths: Array(9).fill(50) as number[],
      minDepth: 50,
      maxDepth: 50,
    });
    expect(buildContourLines(grid, 10)).toEqual([]);
  });

  it("returns empty array when minDepth === maxDepth and no interval falls inside", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 0, 0],
      minDepth: 0,
      maxDepth: 0,
    });
    expect(buildContourLines(grid, 10)).toEqual([]);
  });

  it("returns empty array when the interval is larger than the full depth range", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 5, 5],
      minDepth: 0,
      maxDepth: 5,
    });
    expect(buildContourLines(grid, 100)).toEqual([]);
  });
});

describe("buildContourLines — max segments guard", () => {
  it("never emits more than MAX_CONTOUR_SEGMENTS segments", () => {
    // High-resolution grid + very fine interval → would generate far more
    // segments than the cap without the guard. Alternating depths force a
    // crossing in every cell at every iso-level.
    const W = 256;
    const H = 256;
    const depths: number[] = new Array(W * H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths[r * W + c] = (r + c) % 2 === 0 ? 0 : 100;
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 100 });
    const segs = buildContourLines(grid, 0.5);
    expect(segs.length).toBeLessThanOrEqual(MAX_CONTOUR_SEGMENTS);
    expect(segs.length).toBe(MAX_CONTOUR_SEGMENTS);
  });

  it("small grids with fine intervals are unaffected by the cap", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 2, 2],
      minDepth: 0,
      maxDepth: 2,
    });
    const segs = buildContourLines(grid, 0.5);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.length).toBeLessThan(MAX_CONTOUR_SEGMENTS);
  });
});

describe("buildContourLines — known grid crossings", () => {
  it("generates at least one segment for a 2×2 grid whose depths straddle the iso-level", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 20, 20],
      minDepth: 0,
      maxDepth: 20,
    });
    const segs = buildContourLines(grid, 10);
    expect(segs.length).toBeGreaterThan(0);
  });

  it("segment depth equals the iso-depth value, not an interpolated grid depth", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [5, 5, 25, 25],
      minDepth: 5,
      maxDepth: 25,
    });
    const segs = buildContourLines(grid, 10);
    const isoDepths = segs.map((s) => s.depth);
    // Only 10 and 20 are valid iso-levels between 5 and 25
    for (const d of isoDepths) {
      expect(d === 10 || d === 20).toBe(true);
    }
  });

  it("produces segments at multiple distinct iso-depths when range spans several intervals", () => {
    const grid = makeGrid({
      width: 2,
      height: 5,
      depths: [0, 0, 10, 10, 20, 20, 30, 30, 40, 40],
      minDepth: 0,
      maxDepth: 40,
    });
    const segs = buildContourLines(grid, 10);
    const uniqueDepths = new Set(segs.map((s) => s.depth));
    expect(uniqueDepths.size).toBeGreaterThanOrEqual(3);
  });

  it("all segment x/y coordinates stay within the grid's fractional bounds", () => {
    const W = 4;
    const H = 4;
    const depths: number[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        depths.push(r * 20);
      }
    }
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 0, maxDepth: 60 });
    const segs = buildContourLines(grid, 10);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      expect(seg.x0).toBeGreaterThanOrEqual(0);
      expect(seg.x0).toBeLessThanOrEqual(W - 1);
      expect(seg.y0).toBeGreaterThanOrEqual(0);
      expect(seg.y0).toBeLessThanOrEqual(H - 1);
      expect(seg.x1).toBeGreaterThanOrEqual(0);
      expect(seg.x1).toBeLessThanOrEqual(W - 1);
      expect(seg.y1).toBeGreaterThanOrEqual(0);
      expect(seg.y1).toBeLessThanOrEqual(H - 1);
    }
  });

  it("a fully-uniform row produces no segments even when neighbouring rows differ", () => {
    // Only cells that span a row boundary with a depth crossing produce segments.
    // Row0=[0,0], Row1=[0,0], Row2=[20,20]: crossing is between row1 and row2.
    const grid = makeGrid({
      width: 2,
      height: 3,
      depths: [0, 0, 0, 0, 20, 20],
      minDepth: 0,
      maxDepth: 20,
    });
    const segs = buildContourLines(grid, 10);
    // All segments should report depth=10
    for (const seg of segs) {
      expect(seg.depth).toBe(10);
    }
  });

  it("a horizontal step edge produces only segments with matching y-coordinates at the boundary row", () => {
    // Top row all-zero, bottom row all-100: iso at 50 crosses every cell's bottom edge.
    const W = 4;
    const grid = makeGrid({
      width: W,
      height: 2,
      depths: [0, 0, 0, 0, 100, 100, 100, 100],
      minDepth: 0,
      maxDepth: 100,
    });
    const segs = buildContourLines(grid, 50);
    expect(segs.length).toBeGreaterThan(0);
    // Every segment y-coordinate should be between 0 and 1 (the only row boundary)
    for (const seg of segs) {
      expect(seg.y0).toBeGreaterThanOrEqual(0);
      expect(seg.y0).toBeLessThanOrEqual(1);
      expect(seg.y1).toBeGreaterThanOrEqual(0);
      expect(seg.y1).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// renderIntertidalBand — deep-water cells and null-MHW early exit
// ---------------------------------------------------------------------------

describe("renderIntertidalBand — deep-water cells and null-MHW early exit", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A grid whose every cell is 50 m below datum (positive depth = open water).
   * The teal lower-band condition is `depth <= 0 && depth >= -mhwM`.
   * A depth of +50 fails the first predicate regardless of mhwM, so no pixel
   * should receive a non-zero alpha even when mhwFt is a realistic 2 ft value.
   */
  it("does not colour any pixel when the grid contains only a 50 m-deep cell and mhwFt=2", () => {
    const deepGrid = makeGrid({
      width: 2,
      height: 2,
      depths: [50, 50, 50, 50],
      minDepth: 50,
      maxDepth: 50,
    });

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();
    const mainCtx = {
      ...makeCtx(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const t = makeTransform({ pxPerDeg: 100 });

    renderIntertidalBand(mainCtx, deepGrid, deepGrid, t, /* mhwFt */ 2, /* mhhwFt */ null);
    createElementSpy.mockRestore();

    // Exactly one putImageData call for the 128×128 offscreen raster.
    expect(capturedImageDatas.length).toBe(1);
    const px = capturedImageDatas[0]!;

    // Every alpha channel byte (indices 3, 7, 11, …) must remain 0 —
    // no intertidal colour was painted over genuinely deep open-water cells.
    let anyColored = false;
    for (let i = 3; i < px.length; i += 4) {
      if ((px[i] ?? 0) > 0) {
        anyColored = true;
        break;
      }
    }
    expect(anyColored).toBe(false);
  });

  /**
   * When mhwFt is null the function must return early before touching the
   * canvas at all — neither the offscreen raster nor a drawImage call should
   * be issued, regardless of what mhhwFt is set to.
   */
  it("returns without drawing anything when mhwFt is null even if mhhwFt is set", () => {
    const grid = makeGrid();
    const drawImageMock = vi.fn();
    const mainCtx = {
      ...makeCtx(),
      drawImage: drawImageMock,
    } as unknown as CanvasRenderingContext2D;
    const t = makeTransform({ pxPerDeg: 100 });

    renderIntertidalBand(mainCtx, grid, grid, t, /* mhwFt */ null, /* mhhwFt */ 6);

    expect(drawImageMock).not.toHaveBeenCalled();
  });
});
