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

  it("contains no NaN or Infinity cells after IDW fill", () => {
    const pts = makePoints(25);
    const grid = gridPoints(pts, 32, "test", "Test Grid");
    for (const d of grid.depths) {
      expect(Number.isFinite(d)).toBe(true);
      expect(Number.isNaN(d)).toBe(false);
    }
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
    for (const d of grid.depths) {
      expect(Number.isFinite(d)).toBe(true);
    }
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
