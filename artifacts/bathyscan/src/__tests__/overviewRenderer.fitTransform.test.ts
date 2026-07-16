/**
 * Regression tests for computeFitTransform — the "Fit to Data" bounds-
 * computation utility used by the OverviewMap toolbar button.
 *
 * Coverage:
 *   1. Single-dataset bbox → transform centres at 88% fill, scale = 1.
 *   2. Union of two non-overlapping bboxes → transform frames both extents.
 *   3. Wide bbox (land-span) → pxPerDeg is limited by the wider dimension.
 *   4. Tall bbox (pole-adjacent) → pxPerDeg is limited by the taller dimension.
 *   5. Antimeridian-crossing bbox (minLon > maxLon) → span is treated correctly.
 *   6. Degenerate zero-lon-range bbox → falls back to span = 1 (no divide-by-zero).
 *   7. Transform always produces scale = 1 (only pxPerDeg + offsets change).
 *   8. Resulting transform centres the terrain within the canvas.
 */

import { describe, it, expect } from "vitest";
import { computeFitTransform } from "../lib/overviewRenderer";

const CW = 400;
const CH = 300;

describe("computeFitTransform — single bbox centering", () => {
  it("returns scale = 1 regardless of bbox size", () => {
    const t = computeFitTransform(
      { minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 },
      CW, CH,
    );
    expect(t.scale).toBe(1);
  });

  it("terrain fills ≈ 88% of the narrower canvas dimension", () => {
    const bbox = { minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 };
    const t = computeFitTransform(bbox, CW, CH);
    const lonRange = 1;
    const latRange = 1;
    const terrainW = t.pxPerDeg * lonRange;
    const terrainH = t.pxPerDeg * latRange;
    const fillX = terrainW / CW;
    const fillY = terrainH / CH;
    expect(Math.max(fillX, fillY)).toBeCloseTo(0.88, 3);
  });

  it("terrain is horizontally centred: offsetX = (W - terrainW) / 2", () => {
    const bbox = { minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 };
    const t = computeFitTransform(bbox, CW, CH);
    const terrainW = t.pxPerDeg * 1;
    expect(t.offsetX).toBeCloseTo((CW - terrainW) / 2, 5);
  });

  it("terrain is vertically centred: offsetY = (H - terrainH) / 2", () => {
    const bbox = { minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 };
    const t = computeFitTransform(bbox, CW, CH);
    const terrainH = t.pxPerDeg * 1;
    expect(t.offsetY).toBeCloseTo((CH - terrainH) / 2, 5);
  });
});

describe("computeFitTransform — union of two non-overlapping bboxes", () => {
  it("wider union produces smaller pxPerDeg than either individual bbox", () => {
    const single = computeFitTransform(
      { minLon: -120, maxLon: -119, minLat: 47, maxLat: 48 },
      CW, CH,
    );
    const union = computeFitTransform(
      { minLon: -120, maxLon: -117, minLat: 47, maxLat: 48 },
      CW, CH,
    );
    expect(union.pxPerDeg).toBeLessThan(single.pxPerDeg);
  });

  it("union bbox fills ≈ 88% of the narrower canvas dimension", () => {
    const bbox = { minLon: -122, maxLon: -119, minLat: 46, maxLat: 50 };
    const t = computeFitTransform(bbox, CW, CH);
    const lonRange = 3;
    const latRange = 4;
    const terrainW = t.pxPerDeg * lonRange;
    const terrainH = t.pxPerDeg * latRange;
    const fillX = terrainW / CW;
    const fillY = terrainH / CH;
    expect(Math.max(fillX, fillY)).toBeCloseTo(0.88, 3);
  });

  it("union with zero lat/lon overlap is still framed (different datasets, disjoint)", () => {
    const t = computeFitTransform(
      { minLon: -125, maxLon: -115, minLat: 30, maxLat: 50 },
      CW, CH,
    );
    const lonRange = 10;
    const latRange = 20;
    const terrainW = t.pxPerDeg * lonRange;
    const terrainH = t.pxPerDeg * latRange;
    expect(terrainW).toBeGreaterThan(0);
    expect(terrainH).toBeGreaterThan(0);
    const fillX = terrainW / CW;
    const fillY = terrainH / CH;
    expect(Math.max(fillX, fillY)).toBeCloseTo(0.88, 3);
  });
});

describe("computeFitTransform — limiting dimension", () => {
  it("wide bbox (lonRange >> latRange) is constrained by canvas width", () => {
    const bbox = { minLon: -180, maxLon: 180, minLat: 47, maxLat: 48 };
    const t = computeFitTransform(bbox, CW, CH);
    const terrainW = t.pxPerDeg * 360;
    expect(terrainW / CW).toBeCloseTo(0.88, 3);
  });

  it("tall bbox (latRange >> lonRange) is constrained by canvas height", () => {
    const bbox = { minLon: -120, maxLon: -119, minLat: 0, maxLat: 80 };
    const t = computeFitTransform(bbox, CW, CH);
    const terrainH = t.pxPerDeg * 80;
    expect(terrainH / CH).toBeCloseTo(0.88, 3);
  });
});

describe("computeFitTransform — antimeridian-crossing bbox", () => {
  it("minLon=170, maxLon=-170 → span treated as 20° (not -340°)", () => {
    const regular = computeFitTransform(
      { minLon: 0, maxLon: 20, minLat: 50, maxLat: 60 },
      CW, CH,
    );
    const anti = computeFitTransform(
      { minLon: 170, maxLon: -170, minLat: 50, maxLat: 60 },
      CW, CH,
    );
    expect(anti.pxPerDeg).toBeCloseTo(regular.pxPerDeg, 3);
  });

  it("antimeridian bbox still centres within canvas", () => {
    const t = computeFitTransform(
      { minLon: 170, maxLon: -170, minLat: 50, maxLat: 60 },
      CW, CH,
    );
    const terrainW = t.pxPerDeg * 20;
    const terrainH = t.pxPerDeg * 10;
    expect(t.offsetX).toBeCloseTo((CW - terrainW) / 2, 3);
    expect(t.offsetY).toBeCloseTo((CH - terrainH) / 2, 3);
  });
});

describe("computeFitTransform — degenerate zero-range bbox", () => {
  it("zero lonRange falls back to span = 1 (no NaN or Infinity in output)", () => {
    const t = computeFitTransform(
      { minLon: -120, maxLon: -120, minLat: 47, maxLat: 48 },
      CW, CH,
    );
    expect(isFinite(t.pxPerDeg)).toBe(true);
    expect(isFinite(t.offsetX)).toBe(true);
    expect(isFinite(t.offsetY)).toBe(true);
    expect(t.pxPerDeg).toBeGreaterThan(0);
  });

  it("zero latRange falls back to span = 1 (no NaN or Infinity in output)", () => {
    const t = computeFitTransform(
      { minLon: -120, maxLon: -119, minLat: 47, maxLat: 47 },
      CW, CH,
    );
    expect(isFinite(t.pxPerDeg)).toBe(true);
    expect(isFinite(t.offsetX)).toBe(true);
    expect(isFinite(t.offsetY)).toBe(true);
    expect(t.pxPerDeg).toBeGreaterThan(0);
  });
});
