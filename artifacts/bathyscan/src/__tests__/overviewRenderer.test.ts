import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildHeatmapBitmap,
  buildContourLines,
  renderContourLines,
  buildNodataBoundarySegments,
  renderNodataBoundary,
  MAX_CONTOUR_SEGMENTS,
  lonLatToCanvas,
  canvasToLonLat,
  renderViewCone,
  renderEfhOverlay,
  renderIntertidalBand,
  renderColormapLegend,
} from "../lib/overviewRenderer";

// Shared stub — implementations live in src/__tests__/mocks/three.ts,
// wired via __mocks__/three.ts so no factory is needed here.
vi.mock("three");

import { EfhFeatureType } from "@workspace/api-client-react";
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

  it("a canvas point near the top-center of the terrain rect decodes to a lat closer to maxLat (North-up inverse)", () => {
    // Top-center of the terrain: cx = midpoint of terrain width, cy ≈ 10px from top.
    // With pxPerDeg=200, scale=1, offsetX=0, offsetY=0: terrainH = 200px, terrainW = 200px.
    // Formula: lat = minLat + (1 - (cy - offsetY) / terrainH) * latRange
    //        = 47 + (1 - 10/200) * 1 = 47.95 — closer to maxLat (48) than minLat (47).
    const cx = 100; // horizontal midpoint
    const cy = 10;  // 10px from top edge
    const { lat } = canvasToLonLat(cx, cy, grid, t);
    expect(Math.abs(lat - grid.maxLat)).toBeLessThan(Math.abs(lat - grid.minLat));
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
    textAlign: "start" as CanvasTextAlign,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    measureText: vi.fn(() => ({ width: 50 })),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  };
}

describe("renderColormapLegend — Overview control-stack spacing", () => {
  it("starts below the zoom strip and keeps the gradient and labels visible", () => {
    const canvasW = 1024;
    const canvasH = 512;
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;

    renderColormapLegend(ctx, "ocean", 0, 150, canvasW, canvasH, "metric");

    const gradientCalls = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, , width, height]: [number, number, number, number]) =>
        width === 10 && height === 1,
    );
    const gradientYs = gradientCalls.map(([, y]: [number, number]) => y);
    expect(gradientCalls).toHaveLength(120);
    expect(gradientYs[0]).toBeGreaterThanOrEqual(204);
    expect(gradientYs[gradientYs.length - 1]! + 1).toBeLessThanOrEqual(canvasH);

    const border = (ctx.strokeRect as ReturnType<typeof vi.fn>).mock.calls[0] as [
      number,
      number,
      number,
      number,
    ];
    expect(border[1]).toBeGreaterThanOrEqual(204);
    expect(border[1]! + border[3]!).toBeLessThanOrEqual(canvasH);

    const tickYs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, y]: [number, number]) => y,
    );
    expect(tickYs).toEqual([204, 264, 323]);

    const labels = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls;
    expect(labels).toHaveLength(3);
    expect(labels.map(([text]: [string]) => text)).toEqual(["0m", "75m", "150m"]);
    expect(labels.map(([, , y]: [string, number, number]) => y)).toEqual([204, 264, 324]);
  });
});

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
// buildContourLines — null / no-data cell suppression
// ---------------------------------------------------------------------------

describe("buildContourLines — null cell suppression", () => {
  /**
   * 4×4 grid where the centre 2×2 block (rows 1–2, cols 1–2) is null and the
   * surrounding ring has real depths spanning several iso-depth intervals.
   *
   * Layout (row-major, null = no survey data):
   *   10  10  10  10
   *   10  null null 10
   *   10  null null 10
   *   10  10  10  10
   *
   * No contour segment endpoint should map into the null quad columns/rows.
   * Quads that touch the null block occupy:
   *   (row=1,col=1), (row=1,col=2) — top-inner row
   *   (row=2,col=1), (row=2,col=2) — bottom-inner row
   *
   * A quad at (row, col) covers grid cols [col, col+1] and rows [row, row+1].
   * The null cells occupy grid positions (row 1, col 1), (row 1, col 2),
   * (row 2, col 1), (row 2, col 2).  Any segment touching those positions
   * would indicate a phantom line.
   */
  it("produces no segments whose endpoints fall inside the null block", () => {
    const W = 4;
    const H = 4;
    // Surrounding ring = 10 m, centre 2×2 = null
    const depths: (number | null)[] = [
      10,   10,   10,   10,
      10,   null, null, 10,
      10,   null, null, 10,
      10,   10,   10,   10,
    ];
    const grid = makeGrid({
      width: W,
      height: H,
      depths,
      minDepth: 10,
      maxDepth: 50,
    });
    const segs = buildContourLines(grid, 10);

    // Null cells sit at grid (row, col): (1,1), (1,2), (2,1), (2,2).
    // Any segment endpoint with col in (1,2] AND row in (1,2] would be
    // inside or on the border of the null block.
    for (const seg of segs) {
      const insideNull = (x: number, y: number) =>
        x > 1 - 1e-9 && x < 3 + 1e-9 && y > 1 - 1e-9 && y < 3 + 1e-9;
      expect(insideNull(seg.x0, seg.y0)).toBe(false);
      expect(insideNull(seg.x1, seg.y1)).toBe(false);
    }
  });

  it("still produces segments on fully-dense grids (no regression)", () => {
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 20, 20],
      minDepth: 0,
      maxDepth: 20,
    });
    expect(buildContourLines(grid, 10).length).toBeGreaterThan(0);
  });

  it("returns empty array when the whole grid is null", () => {
    const depths: (number | null)[] = [null, null, null, null];
    const grid = makeGrid({
      width: 2,
      height: 2,
      depths,
      minDepth: 0,
      maxDepth: 100,
    });
    expect(buildContourLines(grid, 10)).toEqual([]);
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

// ---------------------------------------------------------------------------
// buildHeatmapBitmap — topography / land-cell rendering
//
// When a topography array is supplied, cells with topography[dataIdx] > 0 must
// be rendered as flat grey (120, 120, 120) to match the 3D shader land colour.
// Cells with topography ≤ 0 (water) must use the colourmap as normal.
// Null / NaN depth values must still render as the NO_DATA colour even when a
// topography array is present (the null check comes first in the loop).
// ---------------------------------------------------------------------------

// Precompute the expected no-data RGBA bytes for assertions.
// NO_DATA_COLOR = { r: 0.75, g: 0.75, b: 0.75 }  (linear sRGB)
// linearToSRGBByte(0.75) ≈ round(1.055 * 0.75^(1/2.4) - 0.055) * 255
function expectedNoDataByte(): number {
  const c = 0.75;
  const s = 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

describe("buildHeatmapBitmap — topography array: land cells rendered as grey", () => {
  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  /**
   * Layout for a 2×2 grid with Y-flip applied by buildHeatmapBitmap:
   *   dataIdx = (H - 1 - row) * W + col
   *
   *   Canvas pixel → dataIdx:
   *     (row=0,col=0) → 2   (row=0,col=1) → 3
   *     (row=1,col=0) → 0   (row=1,col=1) → 1
   *
   * topography = [0, 0, 5, 8]
   *   dataIdx 0 → topo  0 → water (row=1,col=0, i=8)
   *   dataIdx 1 → topo  0 → water (row=1,col=1, i=12)
   *   dataIdx 2 → topo  5 → LAND  (row=0,col=0, i=0)
   *   dataIdx 3 → topo  8 → LAND  (row=0,col=1, i=4)
   */
  it("land cells (topography > 0) are fully transparent (alpha = 0) so they cannot occlude other datasets", () => {
    const W = 2;
    const H = 2;
    const depths = [10, 20, 30, 40];
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 10, maxDepth: 40 });
    const topography = [0, 0, 5, 8];

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", topography);
    createElementSpy.mockRestore();

    expect(capturedImageDatas.length).toBe(1);
    const px = capturedImageDatas[0]!;

    // Canvas pixel 0 → dataIdx 2 (topo=5 → LAND).
    // Land cells are fully transparent (alpha=0) so a later-drawn dataset's
    // real depth pixels are not occluded by this survey's land region.
    expect(px[3]).toBe(0); // alpha = 0 (fully transparent)

    // Canvas pixel 1 (i=4) → dataIdx 3 (topo=8 → LAND)
    expect(px[7]).toBe(0); // alpha = 0 (fully transparent)
  });

  it("water cells (topography ≤ 0) use the depth colourmap, not grey", () => {
    const W = 2;
    const H = 2;
    const depths = [10, 20, 30, 40];
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 10, maxDepth: 40 });
    const topography = [0, 0, 5, 8];

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", topography);
    createElementSpy.mockRestore();

    const px = capturedImageDatas[0]!;

    // Canvas pixel 2 (i=8) → dataIdx 0 (topo=0 → water).
    // Colourmap result must NOT be a flat grey — at least one channel differs from 120.
    const r2 = px[8]!;
    const g2 = px[9]!;
    const b2 = px[10]!;
    const isGrey = r2 === 120 && g2 === 120 && b2 === 120;
    expect(isGrey).toBe(false);

    // Canvas pixel 3 (i=12) → dataIdx 1 (topo=0 → water).
    const r3 = px[12]!;
    const g3 = px[13]!;
    const b3 = px[14]!;
    const isGrey2 = r3 === 120 && g3 === 120 && b3 === 120;
    expect(isGrey2).toBe(false);
  });

  it("all cells use the colourmap when no topography array is supplied (purely marine grid)", () => {
    const W = 2;
    const H = 2;
    const depths = [10, 20, 30, 40];
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 10, maxDepth: 40 });

    const { capturedImageDatas: withTopoData, createElementSpy: spy1 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", [0, 0, 5, 8]);
    spy1.mockRestore();

    const { capturedImageDatas: noTopoData, createElementSpy: spy2 } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean");
    spy2.mockRestore();

    const withTopo = withTopoData[0]!;
    const noTopo  = noTopoData[0]!;

    // Land pixels (i=0 and i=4) should differ — transparent (0,0,0,0) with topo, colourmap without.
    const landPixelsDiffer =
      withTopo[0] !== noTopo[0] ||
      withTopo[4] !== noTopo[4];
    expect(landPixelsDiffer).toBe(true);

    // Without topography, none of the pixels should be the flat grey 120,120,120
    // for what would be the same grid positions (unless the colourmap itself
    // happened to produce that exact triplet, which is astronomically unlikely).
    for (let i = 0; i < 4; i++) {
      const base = i * 4;
      const r = noTopo[base]!;
      const g = noTopo[base + 1]!;
      const b = noTopo[base + 2]!;
      // Flag only if ALL three channels are exactly 120 — the land grey.
      const allGrey = r === 120 && g === 120 && b === 120;
      expect(allGrey).toBe(false);
    }
  });

  it("null depth cells render as NO_DATA colour even when topography is present", () => {
    const W = 2;
    const H = 2;
    // dataIdx 0 (→ canvas row=1,col=0, i=8) has null depth.
    const depths = [null as unknown as number, 20, 30, 40];
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 20, maxDepth: 40 });
    // Topography marks dataIdx 0 as land too — the null check must win.
    const topography = [5, 0, 0, 0];

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", topography);
    createElementSpy.mockRestore();

    const px = capturedImageDatas[0]!;
    const noDataByte = expectedNoDataByte();

    // Canvas pixel 2 (i=8) → dataIdx 0 → null depth → NO_DATA colour, not grey.
    // Alpha is 0 (transparent) so overlapping datasets show through in multi-dataset mode.
    expect(px[8]).toBe(noDataByte);
    expect(px[9]).toBe(noDataByte);
    expect(px[10]).toBe(noDataByte);
    expect(px[11]).toBe(0);

    // Must NOT be the land grey.
    const isLandGrey = px[8] === 120 && px[9] === 120 && px[10] === 120;
    expect(isLandGrey).toBe(false);
  });

  it("NaN depth cells render as NO_DATA colour even when topography marks them as land", () => {
    const W = 2;
    const H = 2;
    // dataIdx 1 (→ canvas row=1,col=1, i=12) has NaN depth.
    const depths = [10, NaN, 30, 40];
    const grid = makeGrid({ width: W, height: H, depths, minDepth: 10, maxDepth: 40 });
    // Topography also marks dataIdx 1 as land — null/NaN check takes priority.
    const topography = [0, 3, 0, 0];

    const { capturedImageDatas, createElementSpy } = setupCanvasMock();
    buildHeatmapBitmap(grid, "ocean", topography);
    createElementSpy.mockRestore();

    const px = capturedImageDatas[0]!;
    const noDataByte = expectedNoDataByte();

    // Canvas pixel 3 (i=12) → dataIdx 1 → NaN depth → NO_DATA colour.
    // Alpha is 0 (transparent) so overlapping datasets show through in multi-dataset mode.
    expect(px[12]).toBe(noDataByte);
    expect(px[13]).toBe(noDataByte);
    expect(px[14]).toBe(noDataByte);
    expect(px[15]).toBe(0);

    const isLandGrey = px[12] === 120 && px[13] === 120 && px[14] === 120;
    expect(isLandGrey).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderContourLines — palette staleness and edge-case robustness
// ---------------------------------------------------------------------------

describe("renderContourLines — palette staleness and edge-case robustness", () => {
  // 2×2 grid with a depth crossing at 10 m so buildContourLines always returns segments.
  const grid = makeGrid({
    width: 2,
    height: 2,
    depths: [0, 0, 20, 20],
    minDepth: 0,
    maxDepth: 20,
  });
  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });

  /** ctx extended with ctx.canvas.{width,height} required by renderContourLines. */
  function makeCtxWithCanvas() {
    return {
      ...makeCtx(),
      canvas: { width: 400, height: 400 },
    } as unknown as CanvasRenderingContext2D;
  }

  /** Read back the last strokeStyle written to the mock ctx. */
  function lastStrokeStyle(ctx: CanvasRenderingContext2D): string {
    return (ctx as unknown as { strokeStyle: string }).strokeStyle;
  }

  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("preset theme ('thermal') ignores populated bandColors and uses the colormap-sample path, producing a different color than the band path", () => {
    // After reset(): DEFAULT_BAND_COLORS[2] = '#00c0e0' (15–35 ft band = 4.57–10.67 m).
    // For depth=10 m ≈ 32.8 ft, the band path selects band index 2 (10 m < 10.67 m boundary)
    // → rgb(0,192,224).  (Old scheme had a single 0–50 ft band so 10 m → band 0.)
    const segments = buildContourLines(grid, 10);
    expect(segments.length).toBeGreaterThan(0);

    // Control — ocean theme (absolute-depth) must use the band path.
    // Expected: '#00c0e0' = r=0x00=0, g=0xc0=192, b=0xe0=224 → "rgb(0,192,224)".
    const ctxOcean = makeCtxWithCanvas();
    renderContourLines(ctxOcean, segments, grid, t, "metric", "ocean");
    const oceanStyle = lastStrokeStyle(ctxOcean);
    expect(oceanStyle).toBe("rgb(0,192,224)"); // band[2] colour for 4.57 m < depth < 10.67 m

    // Thermal with the same store state must use the colormap-sample path, not the band path.
    // Expected computation:  thermal is grid-relative → contourDomain = {min:0, max:20}.
    //   t01 = (10 - 0) / 20 = 0.5
    //   Thermal stops: t=0.25 → #7b2d8b (r=123,g=45,b=139), t=0.55 → #e8553e (r=232,g=85,b=62).
    //   0.5 falls in [0.25, 0.55]: alpha = (0.5-0.25)/(0.55-0.25) = 5/6 ≈ 0.8333.
    //   lerpColors: r=round(123+109*(5/6))=round(213.83)=214,
    //               g=round(45+40*(5/6))=round(78.33)=78,
    //               b=round(139-77*(5/6))=round(74.83)=75.
    //   convertLinearToSRGB() is a no-op in the test mock.
    const ctxThermal = makeCtxWithCanvas();
    renderContourLines(ctxThermal, segments, grid, t, "metric", "thermal");
    const thermalStyle = lastStrokeStyle(ctxThermal);
    // Must NOT be the band-path colour — proves band data was ignored.
    expect(thermalStyle).not.toBe(oceanStyle);
    // Must match the exact colormap-sample result — proves the colormap-sample path was taken.
    expect(thermalStyle).toBe("rgb(214,78,75)");
  });

  it("does not crash and still draws contours when bandColors is empty (graceful fallback to colormap sample)", () => {
    // Force bandColors to empty by bypassing the store's mutation guards.
    // This simulates a failed migration or corrupt localStorage state.
    usePaletteStore.setState({ bandColors: [] });

    const segments = buildContourLines(grid, 10);
    expect(segments.length).toBeGreaterThan(0);

    const ctx = makeCtxWithCanvas();
    // 'ocean' is an absolute-depth theme (_rcIsBand = true), but the band-path
    // guard `_rcBandColorsArr.length > 0` fails when bandColors is empty, so the
    // colormap-sample fallback is used — no crash, contours still drawn.
    expect(() => renderContourLines(ctx, segments, grid, t, "metric", "ocean")).not.toThrow();
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("does not crash when bandColors and bandBoundaries lengths are mismatched (e.g. after a failed migration)", () => {
    // Force a mismatch: 3 colours but only 2 boundaries (valid pair requires 4 boundaries
    // for 3 colours).  This violates the store invariant and cannot happen through normal
    // UI paths, but can occur when localStorage is corrupt.
    usePaletteStore.setState({
      bandColors: ["#00e5ff", "#0288d1", "#283593"],
      // 2 boundaries defines only 1 band — mismatched with 3 colours above.
      bandBoundaries: [0, 2000],
    });

    const segments = buildContourLines(grid, 10);
    expect(segments.length).toBeGreaterThan(0);

    const ctx = makeCtxWithCanvas();
    // renderContourLines clamps the band index via Math.min(bi, length-1) so even
    // with a length mismatch it must not throw and must still produce strokes.
    expect(() => renderContourLines(ctx, segments, grid, t, "metric", "ocean")).not.toThrow();
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// renderContourLines — worldGrid canvas projection (multi-dataset regression)
// ---------------------------------------------------------------------------

describe("renderContourLines — worldGrid canvas projection in multi-dataset mode", () => {
  // Primary dataset: small patch, 2×2, depths [0,0,20,20].
  // The contour at 10 m lies at gy=0.5, gx=0..1:
  //   lon = minLon + (gx/(W-1)) * lonRange  →  gx=0 → -120, gx=1 → -119
  //   lat = minLat + (gy/(H-1)) * latRange  →  gy=0.5 → 47.5
  const primaryGrid = makeGrid({
    width: 2,
    height: 2,
    depths: [0, 0, 20, 20],
    minDepth: 0,
    maxDepth: 20,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
  });

  // World grid: larger bbox (extends 1° west, 1° south, 1° north).
  // maxLat differs from primaryGrid so Y coords diverge between the two projections.
  const worldGrid = makeGrid({
    width: 2,
    height: 2,
    depths: [0, 0, 20, 20],
    minDepth: 0,
    maxDepth: 20,
    minLon: -121,
    maxLon: -119,
    minLat: 46,
    maxLat: 49,
  });

  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });

  // Contour at depth=10 is at gy=0.5, gx spans 0..1 → lon=-120..-119, lat=47.5.
  // Use the western endpoint (gx=0) as the representative point.
  const contourLon = primaryGrid.minLon; // -120
  const contourLat = primaryGrid.minLat + 0.5 * (primaryGrid.maxLat - primaryGrid.minLat); // 47.5

  function makeCtxWithCanvas() {
    return {
      ...makeCtx(),
      canvas: { width: 800, height: 800 },
    } as unknown as CanvasRenderingContext2D;
  }

  beforeEach(() => {
    usePaletteStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("contour points use worldGrid for canvas projection — not primaryGrid", () => {
    const segments = buildContourLines(primaryGrid, 10);
    expect(segments.length).toBeGreaterThan(0);

    // Expected canvas position when worldGrid is the reference.
    const [expectedX, expectedY] = lonLatToCanvas(contourLon, contourLat, worldGrid, t);

    // Wrong position — what the old code produced (primaryGrid as reference).
    const [wrongX, wrongY] = lonLatToCanvas(contourLon, contourLat, primaryGrid, t);

    // Sanity: the two projections must differ in both axes so the test is meaningful.
    expect(expectedX).not.toBeCloseTo(wrongX, 1);
    expect(expectedY).not.toBeCloseTo(wrongY, 1);

    // Render with worldGrid and capture stroke paths.
    const ctx = makeCtxWithCanvas();
    renderContourLines(ctx, segments, primaryGrid, t, "metric", "ocean", worldGrid);

    const moveToArgs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const lineToArgs = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const allPoints = [...moveToArgs, ...lineToArgs];
    expect(allPoints.length).toBeGreaterThan(0);

    // At least one point must be close to the worldGrid-projected position.
    const TOLERANCE = 2;
    const hasWorldGridPoint = allPoints.some(
      ([px, py]) => Math.abs(px - expectedX) < TOLERANCE && Math.abs(py - expectedY) < TOLERANCE,
    );
    // No point should land at the (wrong) primaryGrid-projected position.
    const hasWrongGridPoint = allPoints.some(
      ([px, py]) => Math.abs(px - wrongX) < TOLERANCE && Math.abs(py - wrongY) < TOLERANCE,
    );

    expect(hasWorldGridPoint).toBe(true);
    expect(hasWrongGridPoint).toBe(false);
  });

  it("without worldGrid argument canvas coords stay in primaryGrid space — single-dataset backward compat", () => {
    const segments = buildContourLines(primaryGrid, 10);
    expect(segments.length).toBeGreaterThan(0);

    // Without worldGrid the reference grid is primaryGrid.
    const [expectedX, expectedY] = lonLatToCanvas(contourLon, contourLat, primaryGrid, t);
    const [worldX, worldY] = lonLatToCanvas(contourLon, contourLat, worldGrid, t);

    const ctx = makeCtxWithCanvas();
    renderContourLines(ctx, segments, primaryGrid, t, "metric", "ocean");

    const moveToArgs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const lineToArgs = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const allPoints = [...moveToArgs, ...lineToArgs];
    expect(allPoints.length).toBeGreaterThan(0);

    const TOLERANCE = 2;
    const hasPrimaryPoint = allPoints.some(
      ([px, py]) => Math.abs(px - expectedX) < TOLERANCE && Math.abs(py - expectedY) < TOLERANCE,
    );
    const hasWorldPoint = allPoints.some(
      ([px, py]) => Math.abs(px - worldX) < TOLERANCE && Math.abs(py - worldY) < TOLERANCE,
    );

    expect(hasPrimaryPoint).toBe(true);
    expect(hasWorldPoint).toBe(false);
  });

  it("calling renderContourLines once per dataset draws contours from both datasets in worldGrid space", () => {
    // Secondary dataset: 2×2 grid with the same depth crossing (0→20 m),
    // placed south-west of the primary so the two contour positions are distinct.
    const secondaryGrid = makeGrid({
      width: 2,
      height: 2,
      depths: [0, 0, 20, 20],
      minDepth: 0,
      maxDepth: 20,
      minLon: -121,
      maxLon: -120,
      minLat: 46,
      maxLat: 47,
      datasetId: "secondary",
    });

    const primarySegs = buildContourLines(primaryGrid, 10);
    const secondarySegs = buildContourLines(secondaryGrid, 10);

    expect(primarySegs.length).toBeGreaterThan(0);
    expect(secondarySegs.length).toBeGreaterThan(0);

    // Render primary segments using its own grid + worldGrid as coordinate frame.
    const ctx1 = makeCtxWithCanvas();
    renderContourLines(ctx1, primarySegs, primaryGrid, t, "metric", "ocean", worldGrid);

    // Render secondary segments using its own grid + worldGrid as coordinate frame.
    const ctx2 = makeCtxWithCanvas();
    renderContourLines(ctx2, secondarySegs, secondaryGrid, t, "metric", "ocean", worldGrid);

    // Both calls must produce stroke paths (neither is a no-op).
    expect((ctx1.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect((ctx2.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);

    // The two contour lines should project to different canvas Y positions.
    // Primary grid is north (lat 47–48), secondary is south (lat 46–47).
    // North-up canvas: primary contours (lat≈47.5) → smaller Y; secondary (lat≈46.5) → larger Y.
    const primaryMoveY = (ctx1.moveTo as ReturnType<typeof vi.fn>).mock.calls
      .map(([, y]: [number, number]) => y);
    const secondaryMoveY = (ctx2.moveTo as ReturnType<typeof vi.fn>).mock.calls
      .map(([, y]: [number, number]) => y);

    expect(primaryMoveY.length).toBeGreaterThan(0);
    expect(secondaryMoveY.length).toBeGreaterThan(0);

    const primaryMidY = primaryMoveY.reduce((a: number, b: number) => a + b, 0) / primaryMoveY.length;
    const secondaryMidY = secondaryMoveY.reduce((a: number, b: number) => a + b, 0) / secondaryMoveY.length;

    // Primary (north) must render higher on canvas (smaller Y) than secondary (south).
    expect(primaryMidY).toBeLessThan(secondaryMidY);
  });
});

// ---------------------------------------------------------------------------
// renderNodataBoundary — worldGrid canvas projection (multi-dataset regression)
// ---------------------------------------------------------------------------

describe("renderNodataBoundary — worldGrid canvas projection in multi-dataset mode", () => {
  // Primary dataset: 2×2 grid where the top row is null (nodata) and bottom
  // row has real depth values.  The boundary between the two rows produces
  // horizontal segments at gy=1 spanning gx=0..2.
  //
  // With W=2, the toCanvas formula converts:
  //   lon = grid.minLon + (gx / max(W,1)) * lonRange = minLon + gx/2 * lonRange
  //   lat = grid.minLat + (gy / max(H,1)) * latRange = minLat + gy/2 * latRange
  // So gy=1 → lat = minLat + 0.5 * latRange = midpoint latitude = 47.5
  //    gx=1 → lon = -120 + 0.5 * 1 = -119.5  (mid-segment point)
  const primaryGrid = makeGrid({
    width: 2,
    height: 2,
    depths: [null as unknown as number, null as unknown as number, 10, 10],
    minDepth: 10,
    maxDepth: 10,
    minLon: -120,
    maxLon: -119,
    minLat: 47,
    maxLat: 48,
  });

  // World grid: larger bbox (extends 1° west, 1° south, 1° north) so that
  // the two projections produce meaningfully different canvas coordinates.
  const worldGrid = makeGrid({
    width: 2,
    height: 2,
    depths: [0, 0, 20, 20],
    minDepth: 0,
    maxDepth: 20,
    minLon: -121,
    maxLon: -119,
    minLat: 46,
    maxLat: 49,
  });

  const t = makeTransform({ pxPerDeg: 200, offsetX: 0, offsetY: 0 });

  // The horizontal boundary segment has gy=1, gx=0..2.
  // Use the mid-segment lon/lat as the representative point for projection checks.
  const boundaryLon = primaryGrid.minLon + 0.5 * (primaryGrid.maxLon - primaryGrid.minLon); // -119.5
  const boundaryLat = primaryGrid.minLat + 0.5 * (primaryGrid.maxLat - primaryGrid.minLat); // 47.5

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("boundary segments are built from the null-vs-data boundary in the primary grid", () => {
    const segments = buildNodataBoundarySegments(primaryGrid);
    expect(segments.length).toBeGreaterThan(0);
  });

  it("boundary points use worldGrid for canvas projection — not primaryGrid", () => {
    const segments = buildNodataBoundarySegments(primaryGrid);
    expect(segments.length).toBeGreaterThan(0);

    // Expected canvas position when worldGrid is the reference frame.
    const [expectedX, expectedY] = lonLatToCanvas(boundaryLon, boundaryLat, worldGrid, t);

    // Wrong position — what the old code produced (primaryGrid as reference).
    const [wrongX, wrongY] = lonLatToCanvas(boundaryLon, boundaryLat, primaryGrid, t);

    // Sanity: the two projections must differ so the test is meaningful.
    expect(expectedX).not.toBeCloseTo(wrongX, 1);
    expect(expectedY).not.toBeCloseTo(wrongY, 1);

    // Render with worldGrid and capture stroke paths.
    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderNodataBoundary(ctx, segments, primaryGrid, t, worldGrid);

    const moveToArgs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const lineToArgs = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const allPoints = [...moveToArgs, ...lineToArgs];
    expect(allPoints.length).toBeGreaterThan(0);

    // At least one rendered point must be close to the worldGrid-projected position.
    const TOLERANCE = 2;
    const hasWorldGridPoint = allPoints.some(
      ([px, py]) => Math.abs(px - expectedX) < TOLERANCE && Math.abs(py - expectedY) < TOLERANCE,
    );
    // No point should land at the (wrong) primaryGrid-projected position.
    const hasWrongGridPoint = allPoints.some(
      ([px, py]) => Math.abs(px - wrongX) < TOLERANCE && Math.abs(py - wrongY) < TOLERANCE,
    );

    expect(hasWorldGridPoint).toBe(true);
    expect(hasWrongGridPoint).toBe(false);
  });

  it("calling renderNodataBoundary once per dataset draws segments from both datasets in worldGrid space", () => {
    // Secondary dataset: 2×2 grid offset further south-west, where the bottom
    // row is null (nodata) and the top row has real depth values.
    const secondaryGrid = makeGrid({
      width: 2,
      height: 2,
      depths: [10, 10, null as unknown as number, null as unknown as number],
      minDepth: 10,
      maxDepth: 10,
      minLon: -121,
      maxLon: -120,
      minLat: 46,
      maxLat: 47,
      datasetId: "secondary",
    });

    const primarySegs = buildNodataBoundarySegments(primaryGrid);
    const secondarySegs = buildNodataBoundarySegments(secondaryGrid);

    expect(primarySegs.length).toBeGreaterThan(0);
    expect(secondarySegs.length).toBeGreaterThan(0);

    // Render primary segments using its own grid + worldGrid as coordinate frame.
    const ctx1 = makeCtx() as unknown as CanvasRenderingContext2D;
    renderNodataBoundary(ctx1, primarySegs, primaryGrid, t, worldGrid);

    // Render secondary segments using its own grid + worldGrid as coordinate frame.
    const ctx2 = makeCtx() as unknown as CanvasRenderingContext2D;
    renderNodataBoundary(ctx2, secondarySegs, secondaryGrid, t, worldGrid);

    // Both calls should produce stroke paths (neither is a no-op).
    const primaryMoves = (ctx1.moveTo as ReturnType<typeof vi.fn>).mock.calls.length;
    const secondaryMoves = (ctx2.moveTo as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(primaryMoves).toBeGreaterThan(0);
    expect(secondaryMoves).toBeGreaterThan(0);

    // The two sets of segments should project to distinct canvas regions.
    // Primary boundary (gy=1 in primaryGrid) maps to lat≈47.5.
    // Secondary boundary (gy=1 in secondaryGrid) maps to lat≈46.5.
    // North-up: primary boundary is further north → smaller Y; secondary is further south → larger Y.
    const primaryYVals = (ctx1.moveTo as ReturnType<typeof vi.fn>).mock.calls.map(([, y]: [number, number]) => y);
    const secondaryYVals = (ctx2.moveTo as ReturnType<typeof vi.fn>).mock.calls.map(([, y]: [number, number]) => y);
    const primaryMidY = primaryYVals.reduce((a: number, b: number) => a + b, 0) / primaryYVals.length;
    const secondaryMidY = secondaryYVals.reduce((a: number, b: number) => a + b, 0) / secondaryYVals.length;
    expect(primaryMidY).toBeLessThan(secondaryMidY);
  });

  it("without worldGrid argument canvas coords stay in primaryGrid space — single-dataset backward compat", () => {
    const segments = buildNodataBoundarySegments(primaryGrid);
    expect(segments.length).toBeGreaterThan(0);

    // Without worldGrid the reference grid is primaryGrid.
    const [expectedX, expectedY] = lonLatToCanvas(boundaryLon, boundaryLat, primaryGrid, t);
    const [worldX, worldY] = lonLatToCanvas(boundaryLon, boundaryLat, worldGrid, t);

    const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
    renderNodataBoundary(ctx, segments, primaryGrid, t);

    const moveToArgs = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const lineToArgs = (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls as [number, number][];
    const allPoints = [...moveToArgs, ...lineToArgs];
    expect(allPoints.length).toBeGreaterThan(0);

    const TOLERANCE = 2;
    const hasPrimaryPoint = allPoints.some(
      ([px, py]) => Math.abs(px - expectedX) < TOLERANCE && Math.abs(py - expectedY) < TOLERANCE,
    );
    const hasWorldPoint = allPoints.some(
      ([px, py]) => Math.abs(px - worldX) < TOLERANCE && Math.abs(py - worldY) < TOLERANCE,
    );

    expect(hasPrimaryPoint).toBe(true);
    expect(hasWorldPoint).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Puzzle pixel→geo offset conversion math
// ---------------------------------------------------------------------------
// This tests the same computation that OverviewMap's [puzzleTransforms] effect
// performs: given a tile's canonical center and a pixel-space offset (tx, ty),
// convert both to lon/lat and subtract to obtain the geographic delta.
// Since the math uses lonLatToCanvas + canvasToLonLat (already tested above),
// this suite validates the derived formula with concrete known inputs.

describe("Puzzle pixel→geo offset conversion — known-input round-trip", () => {
  const grid = makeGrid({ minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 });
  // pxPerDeg=100 → terrainW = 100 px, terrainH = 100 px at scale=1
  const t = makeTransform({ pxPerDeg: 100, offsetX: 0, offsetY: 0 });

  /**
   * Replicate the OverviewMap pixel→geo conversion so the test documents the
   * formula clearly and is self-contained.
   */
  function pixelToGeoOffset(
    centerLon: number,
    centerLat: number,
    tx: number,
    ty: number,
  ) {
    const [tcx, tcy] = lonLatToCanvas(centerLon, centerLat, grid, t);
    const canon = canvasToLonLat(tcx, tcy, grid, t);
    const offset = canvasToLonLat(tcx + tx, tcy + ty, grid, t);
    return { dLon: offset.lon - canon.lon, dLat: offset.lat - canon.lat };
  }

  it("zero pixel offset produces zero geographic offset", () => {
    const { dLon, dLat } = pixelToGeoOffset(-119.5, 47.5, 0, 0);
    expect(dLon).toBeCloseTo(0, 8);
    expect(dLat).toBeCloseTo(0, 8);
  });

  it("positive tx (east shift in pixels) produces positive dLon", () => {
    const { dLon, dLat } = pixelToGeoOffset(-119.5, 47.5, 10, 0);
    // 10 px east in a 100px-wide terrain that spans 1° lon → dLon = 0.1°
    expect(dLon).toBeCloseTo(0.1, 5);
    expect(dLat).toBeCloseTo(0, 5);
  });

  it("negative ty (north shift in pixels, North-up means smaller y = more north) produces positive dLat", () => {
    const { dLon, dLat } = pixelToGeoOffset(-119.5, 47.5, 0, -10);
    // North-up: decreasing y → increasing lat. 10 px in 100px terrain = 0.1° lat.
    expect(dLon).toBeCloseTo(0, 5);
    expect(dLat).toBeCloseTo(0.1, 5);
  });

  it("positive ty (south shift) produces negative dLat", () => {
    const { dLon, dLat } = pixelToGeoOffset(-119.5, 47.5, 0, 10);
    expect(dLon).toBeCloseTo(0, 5);
    expect(dLat).toBeCloseTo(-0.1, 5);
  });

  it("diagonal shift of (+10px, -10px) produces expected (+0.1°, +0.1°) offset", () => {
    const { dLon, dLat } = pixelToGeoOffset(-119.5, 47.5, 10, -10);
    expect(dLon).toBeCloseTo(0.1, 5);
    expect(dLat).toBeCloseTo(0.1, 5);
  });

  it("applying dLon/dLat to the canonical bbox center recovers the offset canvas position", () => {
    const tx = 15;
    const ty = -5;
    const centerLon = -119.5;
    const centerLat = 47.5;
    const { dLon, dLat } = pixelToGeoOffset(centerLon, centerLat, tx, ty);

    // Re-encode the shifted lon/lat back to canvas pixels — must match (tcx+tx, tcy+ty).
    const [tcx, tcy] = lonLatToCanvas(centerLon, centerLat, grid, t);
    const [shiftedCx, shiftedCy] = lonLatToCanvas(centerLon + dLon, centerLat + dLat, grid, t);
    expect(shiftedCx).toBeCloseTo(tcx + tx, 5);
    expect(shiftedCy).toBeCloseTo(tcy + ty, 5);
  });
});
