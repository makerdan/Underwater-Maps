/**
 * mobileTapQuery.test.ts — pure-math coverage for the MOBILE-ONLY Analyze
 * tap-to-query helpers (task: Mobile Plan & Analyze tabs).
 *
 * No mocks: uses the real overviewRenderer coordinate transforms so the
 * canvas→lon/lat→cell mapping is tested end to end, including:
 *   - taps outside the grid bbox → null
 *   - taps on null (no-data) cells → depthM null, slopeDeg null
 *   - the row 0 = SOUTH served-grid orientation contract
 *   - slope from central differences (flat grid → 0°, sloped grid → > 0°)
 */
import { describe, it, expect } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import { computeInitialTransform, lonLatToCanvas } from "@/lib/overviewRenderer";
import { queryGridAtCanvasPoint, slopeAtCell } from "@/components/mobile/mobileTapQuery";

/** 5×5 grid over lon −123..−122, lat 47..48; depth = row*10 + col (metres). */
function makeGrid(overrides: Partial<TerrainData> = {}): TerrainData {
  const W = 5;
  const H = 5;
  const depths: Array<number | null> = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) depths.push(r * 10 + c);
  }
  return {
    datasetId: "tap-test",
    width: W,
    height: H,
    depths,
    minLon: -123,
    maxLon: -122,
    minLat: 47,
    maxLat: 48,
    ...overrides,
  } as unknown as TerrainData;
}

const CANVAS_W = 200;
const CANVAS_H = 200;

describe("queryGridAtCanvasPoint", () => {
  it("maps the canvas centre to the grid centre cell with its depth", () => {
    const grid = makeGrid();
    const t = computeInitialTransform(grid, CANVAS_W, CANVAS_H);
    const result = queryGridAtCanvasPoint(CANVAS_W / 2, CANVAS_H / 2, grid, t);
    expect(result).not.toBeNull();
    expect(result!.row).toBe(2);
    expect(result!.col).toBe(2);
    expect(result!.depthM).toBe(22); // row*10 + col
    expect(result!.lon).toBeCloseTo(-122.5, 3);
    expect(result!.lat).toBeCloseTo(47.5, 3);
  });

  it("returns null for taps outside the grid bbox", () => {
    const grid = makeGrid();
    const t = computeInitialTransform(grid, CANVAS_W, CANVAS_H);
    // The fitted terrain has an 0.88 margin, so the canvas corner lies
    // outside the bbox.
    expect(queryGridAtCanvasPoint(0, 0, grid, t)).toBeNull();
    expect(queryGridAtCanvasPoint(CANVAS_W - 1, CANVAS_H - 1, grid, t)).toBeNull();
  });

  it("honours row 0 = SOUTH: a tap near the top of the canvas (north) maps to a high row index", () => {
    const grid = makeGrid();
    const t = computeInitialTransform(grid, CANVAS_W, CANVAS_H);
    // Project a point just inside the northern edge, then query it back.
    const [nx, ny] = lonLatToCanvas(-122.5, 47.99, grid, t);
    const north = queryGridAtCanvasPoint(nx, ny, grid, t);
    expect(north).not.toBeNull();
    expect(north!.row).toBe(grid.height - 1);
    // Canvas Y grows downward, so the northern point sits ABOVE the centre.
    expect(ny).toBeLessThan(CANVAS_H / 2);

    const [sx, sy] = lonLatToCanvas(-122.5, 47.01, grid, t);
    const south = queryGridAtCanvasPoint(sx, sy, grid, t);
    expect(south).not.toBeNull();
    expect(south!.row).toBe(0);
    expect(sy).toBeGreaterThan(CANVAS_H / 2);
  });

  it("returns depthM null and slopeDeg null on a no-data cell", () => {
    const grid = makeGrid();
    // Null out the centre cell (row 2, col 2).
    (grid.depths as Array<number | null>)[2 * grid.width + 2] = null;
    const t = computeInitialTransform(grid, CANVAS_W, CANVAS_H);
    const result = queryGridAtCanvasPoint(CANVAS_W / 2, CANVAS_H / 2, grid, t);
    expect(result).not.toBeNull();
    expect(result!.depthM).toBeNull();
    expect(result!.slopeDeg).toBeNull();
  });
});

describe("slopeAtCell", () => {
  it("returns 0° on a flat grid", () => {
    const grid = makeGrid({ depths: new Array(25).fill(30) } as Partial<TerrainData>);
    expect(slopeAtCell(grid, 2, 2)).toBe(0);
  });

  it("returns a positive slope on a sloped grid and stays finite at edges", () => {
    const grid = makeGrid(); // depth = row*10 + col → gentle uniform slope
    const centre = slopeAtCell(grid, 2, 2);
    expect(centre).not.toBeNull();
    expect(centre!).toBeGreaterThan(0);
    expect(centre!).toBeLessThan(90);
    // Edge/corner cells use clamped one-sided differences — still finite.
    const corner = slopeAtCell(grid, 0, 0);
    expect(corner).not.toBeNull();
    expect(Number.isFinite(corner!)).toBe(true);
  });

  it("falls back to the centre cell when a neighbour is null (no NaN leakage)", () => {
    const grid = makeGrid();
    (grid.depths as Array<number | null>)[2 * grid.width + 1] = null; // west neighbour
    const s = slopeAtCell(grid, 2, 2);
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
  });

  it("returns null when the centre cell itself is null", () => {
    const grid = makeGrid();
    (grid.depths as Array<number | null>)[2 * grid.width + 2] = null;
    expect(slopeAtCell(grid, 2, 2)).toBeNull();
  });
});
