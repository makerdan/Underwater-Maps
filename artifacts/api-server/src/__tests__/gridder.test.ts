import { describe, it, expect } from "vitest";
import { gridPoints } from "../lib/terrain.js";

function makePoints(count: number) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({
      lon: -10 + (i / count) * 20,
      lat: -5 + (i / count) * 10,
      depth: 1000 + i * 10,
    });
  }
  return pts;
}

describe("gridPoints", () => {
  it("produces a grid with resolution×resolution depths array", () => {
    const pts = makePoints(50);
    const grid = gridPoints(pts, 32, "test", "Test Grid");
    expect(grid.depths).toHaveLength(32 * 32);
    expect(grid.width).toBe(32);
    expect(grid.height).toBe(32);
    expect(grid.resolution).toBe(32);
  });

  it("cells are either a finite depth or NaN (survey gap); no Infinity values", () => {
    // makePoints produces a diagonal line, so IDW may leave corner cells as NaN
    // — that is the correct behaviour now (survey gaps → null on the client).
    const pts = makePoints(25);
    const grid = gridPoints(pts, 32, "test", "Test Grid");
    for (const d of grid.depths) {
      // Each cell must be either a valid finite depth or NaN (no-data sentinel).
      expect(Number.isFinite(d) || Number.isNaN(d)).toBe(true);
      // Infinity in either direction is always wrong.
      expect(d).not.toBe(Infinity);
      expect(d).not.toBe(-Infinity);
    }
    // At least some cells should have real depth data from IDW.
    const finiteCells = grid.depths.filter(Number.isFinite);
    expect(finiteCells.length).toBeGreaterThan(0);
  });

  it("computes non-zero minDepth and maxDepth", () => {
    const pts = makePoints(20);
    const grid = gridPoints(pts, 32, "test", "Test Grid");
    expect(grid.minDepth).toBeGreaterThanOrEqual(0);
    expect(grid.maxDepth).toBeGreaterThan(grid.minDepth);
  });

  it("correctly derives bounding box from input points", () => {
    const pts = [
      { lon: 10, lat: 20, depth: 500 },
      { lon: 12, lat: 22, depth: 600 },
      { lon: 11, lat: 21, depth: 550 },
      { lon: 10.5, lat: 21.5, depth: 525 },
      { lon: 11.5, lat: 20.5, depth: 575 },
    ];
    while (pts.length < 15) pts.push({ ...pts[0]!, lon: pts[0]!.lon + pts.length * 0.001 });
    const grid = gridPoints(pts, 32, "custom", "Custom");
    expect(grid.minLon).toBeCloseTo(10, 2);
    expect(grid.maxLon).toBeGreaterThanOrEqual(12);
    expect(grid.minLat).toBeCloseTo(20, 2);
    expect(grid.maxLat).toBeCloseTo(22, 2);
  });

  it("fills a sparse GPS-track grid at the default 256 resolution in seconds, not minutes", () => {
    // Regression: ~12 collinear points (NMEA/GPX track) at resolution 256 used
    // to trigger O(N⁴) ring expansion in the IDW fill — the parse worker spun
    // for 150+ seconds and uploads appeared frozen at 60% progress.
    const pts = [];
    for (let i = 0; i < 12; i++) {
      pts.push({ lon: -132.5 + i * 0.001, lat: 55.2 + i * 0.001, depth: 5 + i });
    }
    const start = Date.now();
    const grid = gridPoints(pts, 256, "sparse", "Sparse Track");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
    expect(grid.depths).toHaveLength(256 * 256);
    // A sparse collinear track will leave many corner cells as NaN (survey gaps).
    // Each cell must be either a finite depth or NaN — never Infinity.
    for (const d of grid.depths) {
      expect(Number.isFinite(d) || Number.isNaN(d)).toBe(true);
      expect(d).not.toBe(Infinity);
      expect(d).not.toBe(-Infinity);
    }
    // Cells along the track must have real depth data.
    expect(grid.depths.filter(Number.isFinite).length).toBeGreaterThan(0);
    expect(grid.maxDepth).toBeGreaterThan(grid.minDepth);
  });

  it("clamps resolution below minimum to 32", () => {
    const pts = makePoints(30);
    expect(gridPoints(pts, 1, "t", "T").resolution).toBe(32);
  });

  it("round-trips a dense 5×5 point cloud without NaN", () => {
    const pts = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        pts.push({ lon: c * 0.5, lat: r * 0.5, depth: 1000 + r * 100 + c * 10 });
      }
    }
    const grid = gridPoints(pts, 32, "test5x5", "5x5");
    expect(grid.depths.every((d) => Number.isFinite(d))).toBe(true);
  });
});

describe("gridPoints — smoothing option (Task #66)", () => {
  // A deliberately spiky synthetic point cloud: alternating shallow / deep
  // measurements on a coarse grid. After resampling to N×N this produces
  // neighbour pairs with depth jumps well past the 70° spike threshold.
  function makeSpikyPoints() {
    const pts: { lon: number; lat: number; depth: number }[] = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        const spike = (r + c) % 2 === 0 ? 50 : 500;
        pts.push({ lon: c * 0.1, lat: r * 0.1, depth: spike });
      }
    }
    return pts;
  }

  it("produces a wider depth range when smoothing is disabled", () => {
    const pts = makeSpikyPoints();
    const smoothed = gridPoints(pts, 64, "spiky", "Spiky", { smoothing: true });
    const raw = gridPoints(pts, 64, "spiky", "Spiky", { smoothing: false });

    const smoothedRange = smoothed.maxDepth - smoothed.minDepth;
    const rawRange = raw.maxDepth - raw.minDepth;

    // Sanity: the raw grid should preserve close-to-original spikes (~450 m).
    expect(rawRange).toBeGreaterThan(400);
    // The smoothed grid must collapse spikes, narrowing the range.
    expect(rawRange).toBeGreaterThan(smoothedRange);
    // The depths arrays must actually differ — proves smoothing ran.
    expect(raw.depths).not.toEqual(smoothed.depths);
  });

  it("defaults smoothing to ON when no option is passed", () => {
    const pts = makeSpikyPoints();
    const def = gridPoints(pts, 64, "spiky", "Spiky");
    const smoothed = gridPoints(pts, 64, "spiky", "Spiky", { smoothing: true });
    // Defaulted call and explicit smoothing:true must produce identical depths.
    expect(def.depths).toEqual(smoothed.depths);
  });
});

describe("gridPoints — depth=0 shoreline spike suppression (uploaded survey path)", () => {
  /**
   * Simulates a near-shoreline uploaded BAG/CSV survey with a sharp
   * waterline boundary: the left half of a 32×32 grid is at depth=0
   * (shoreline) and the right half is at 25 m (open water).  One input
   * point per grid cell (resolution=32 with a 32×32 input) ensures every
   * cell is occupied — no IDW fill can blur the boundary before smoothSpikes
   * runs, mirroring the exact geometry that caused the LRR spike artefact.
   *
   * The boundary column (col 15) sits directly adjacent to the 25 m column
   * (col 16).  The atan2 slope test fires at ≈88° (well above the 70° limit)
   * and the smoother blends col 15 from 0 m toward the 25 m neighbour.
   */
  const GRID_N = 32; // matches gridPoints resolution so every cell is occupied

  function makeShorelineSurvey(): { lon: number; lat: number; depth: number }[] {
    const pts: { lon: number; lat: number; depth: number }[] = [];
    for (let r = 0; r < GRID_N; r++) {
      for (let c = 0; c < GRID_N; c++) {
        pts.push({
          lon: -90.0 + c * 0.001,
          lat: 30.0 + r * 0.001,
          depth: c < GRID_N / 2 ? 0 : 25,
        });
      }
    }
    return pts;
  }

  it("smooths depth=0 shoreline cells adjacent to deep water — upload pipeline default (smoothing ON)", () => {
    const pts = makeShorelineSurvey();
    const N = GRID_N;

    const smoothed = gridPoints(pts, N, "shore-smooth", "Shoreline Survey", {
      smoothing: true,
    });
    const raw = gridPoints(pts, N, "shore-raw", "Shoreline Survey", {
      smoothing: false,
    });

    // Raw grid: boundary col (N/2 − 1 = 15) is exactly 0 m; col 16 is 25 m.
    const BOUNDARY_COL = N / 2 - 1;
    expect(raw.depths[0 * N + BOUNDARY_COL]).toBe(0);
    expect(raw.maxDepth - raw.minDepth).toBeGreaterThan(20);

    // After smoothing, the boundary col must be blended above 0 — the
    // depth=0 cell gets averaged with its 25 m right-neighbour.
    expect(smoothed.depths[0 * N + BOUNDARY_COL]!).toBeGreaterThan(0);

    // The depths arrays must differ — proves the smoother actually ran.
    expect(smoothed.depths).not.toEqual(raw.depths);

    // Every cell must be valid: finite depth or NaN (survey gap).  The
    // smoother must never introduce Infinity or non-numeric values.
    for (const d of smoothed.depths) {
      expect(Number.isFinite(d) || Number.isNaN(d)).toBe(true);
    }
  });

  it("default gridPoints call (no option) applies shoreline smoothing — mirrors upload worker behaviour", () => {
    const pts = makeShorelineSurvey();
    const N = GRID_N;

    // The parse worker calls gridPoints(points, resolution, id, name, { smoothing })
    // where smoothing defaults to the user's stored preference (true by default).
    // Calling gridPoints without options must produce the same result as
    // explicit smoothing:true — confirming the upload pipeline is protected.
    const defaultGrid = gridPoints(pts, N, "shore-default", "Shoreline Survey");
    const explicitSmooth = gridPoints(
      pts,
      N,
      "shore-explicit",
      "Shoreline Survey",
      { smoothing: true },
    );

    expect(defaultGrid.depths).toEqual(explicitSmooth.depths);
    // The boundary col must be smoothed above 0 in the default (on) path.
    const BOUNDARY_COL = N / 2 - 1;
    expect(defaultGrid.depths[0 * N + BOUNDARY_COL]!).toBeGreaterThan(0);
  });

  it("preserves depth=0 as a valid data value when smoothing is off (raw bathymetry mode)", () => {
    // When the user disables "Smooth terrain spikes" the raw depth=0 shoreline
    // cells must still be present and must not be coerced to NaN.
    const pts = makeShorelineSurvey();
    const raw = gridPoints(pts, GRID_N, "shore-raw-only", "Shoreline Survey", {
      smoothing: false,
    });

    // Left half (col 0..15) stays at 0 m — shoreline cells are valid data.
    expect(raw.minDepth).toBeLessThanOrEqual(1);
    // All cells must be finite or NaN — no Infinity from unsmoothed transitions.
    for (const d of raw.depths) {
      expect(Number.isFinite(d) || Number.isNaN(d)).toBe(true);
    }
  });
});
