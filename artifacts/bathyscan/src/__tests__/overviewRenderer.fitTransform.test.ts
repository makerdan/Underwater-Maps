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
import { computeFitTransform, computeInitialTransform, lonLatToCanvas } from "../lib/overviewRenderer";
import type { TerrainData } from "@workspace/api-client-react";

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

// ---------------------------------------------------------------------------
// computeInitialTransform + lonLatToCanvas — union-bbox regression hardening
//
// These tests verify that when OverviewMap synthesises a "world grid" from the
// union of two datasets' bboxes (e.g. minLon=-122, maxLon=-85, minLat=41,
// maxLat=49), computeInitialTransform produces the right transform and
// lonLatToCanvas places each dataset's corners at geographically correct,
// distinct pixel positions within the canvas.
//
// Dataset A: -122..-119 lon, 47..49 lat   (Pacific coast)
// Dataset B:  -88..-85  lon, 41..43 lat   (Great Lakes region)
// Union bbox: -122..-85  lon, 41..49 lat  (37° × 8°)
// ---------------------------------------------------------------------------

/** Minimal synthetic TerrainData carrying only the bbox fields. */
function makeSyntheticGrid(
  minLon: number, maxLon: number,
  minLat: number, maxLat: number,
): TerrainData {
  return { minLon, maxLon, minLat, maxLat } as unknown as TerrainData;
}

const UNION = makeSyntheticGrid(-122, -85, 41, 49); // 37° × 8°
const GRID_A = makeSyntheticGrid(-122, -119, 47, 49); // 3° × 2° (within union)
const GRID_B = makeSyntheticGrid(-88,  -85, 41, 43);  // 3° × 2° (within union)

describe("computeInitialTransform — union-bbox produces correct pxPerDeg and offsets", () => {
  it("pxPerDeg is constrained by the wider lon dimension (37° vs 8°) at 88% fill", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    // lonRange=37, latRange=8 → width-constrained: pxPerDeg = (CW*0.88)/37
    const expected = (CW * 0.88) / 37;
    expect(t.pxPerDeg).toBeCloseTo(expected, 5);
  });

  it("scale is always 1", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    expect(t.scale).toBe(1);
  });

  it("terrain width fills ≈ 88% of canvas width (the constraining dimension)", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const terrainW = t.pxPerDeg * 37;
    expect(terrainW / CW).toBeCloseTo(0.88, 3);
  });

  it("offsetX centres the union terrain horizontally", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const terrainW = t.pxPerDeg * 37;
    expect(t.offsetX).toBeCloseTo((CW - terrainW) / 2, 5);
  });

  it("offsetY centres the union terrain vertically", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const terrainH = t.pxPerDeg * 8;
    expect(t.offsetY).toBeCloseTo((CH - terrainH) / 2, 5);
  });
});

describe("lonLatToCanvas — union transform places each dataset at correct pixel position", () => {
  it("dataset A NW corner (-122, 49) lands near the left edge of the canvas", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const [x] = lonLatToCanvas(-122, 49, UNION, t);
    // A's western edge = union's western edge → x ≈ offsetX
    expect(x).toBeCloseTo(t.offsetX, 1);
  });

  it("dataset A NW corner (-122, 49) lands near the top edge of the canvas", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const [, y] = lonLatToCanvas(-122, 49, UNION, t);
    // A's northern edge = union's northern edge → y ≈ offsetY
    expect(y).toBeCloseTo(t.offsetY, 1);
  });

  it("dataset B NW corner (-88, 43) is to the right of A's NW corner", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const [xA] = lonLatToCanvas(-122, 49, UNION, t);
    const [xB] = lonLatToCanvas(-88,  43, UNION, t);
    expect(xB).toBeGreaterThan(xA);
  });

  it("dataset B NW corner (-88, 43) is below A's NW corner (south = larger Y)", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const [, yA] = lonLatToCanvas(-122, 49, UNION, t);
    const [, yB] = lonLatToCanvas(-88,  43, UNION, t);
    expect(yB).toBeGreaterThan(yA);
  });

  it("pixel distance between A and B NW corners matches expected lon offset", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const [xA] = lonLatToCanvas(-122, 49, UNION, t);
    const [xB] = lonLatToCanvas(-88,  43, UNION, t);
    // B is 34° east of A within a 37° total span
    const expectedDx = (34 / 37) * t.pxPerDeg * 37;
    expect(xB - xA).toBeCloseTo(expectedDx, 1);
  });

  it("all four corners of dataset A map to pixel positions inside the canvas", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const corners: Array<[number, number]> = [
      [-122, 49], [-119, 49], [-122, 47], [-119, 47],
    ];
    for (const [lon, lat] of corners) {
      const [x, y] = lonLatToCanvas(lon, lat, UNION, t);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CW);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CH);
    }
  });

  it("all four corners of dataset B map to pixel positions inside the canvas", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    const corners: Array<[number, number]> = [
      [-88, 43], [-85, 43], [-88, 41], [-85, 41],
    ];
    for (const [lon, lat] of corners) {
      const [x, y] = lonLatToCanvas(lon, lat, UNION, t);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CW);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CH);
    }
  });

  it("A and B SE corners are at distinct pixel positions (non-overlapping datasets)", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    // SE corner of A: maxLon=-119, minLat=47
    const [xASE, yASE] = lonLatToCanvas(-119, 47, UNION, t);
    // NW corner of B: minLon=-88, maxLat=43
    const [xBNW, yBNW] = lonLatToCanvas(-88, 43, UNION, t);
    // B starts well to the right of where A ends
    expect(xBNW).toBeGreaterThan(xASE + 1);
    // B starts below A (larger Y)
    expect(yBNW).toBeGreaterThan(yASE);
  });

  it("GRID_A and GRID_B each render to a different horizontal band of the canvas", () => {
    const t = computeInitialTransform(UNION, CW, CH);
    // Midpoint of each dataset's horizontal span
    const [xAMid] = lonLatToCanvas(-120.5, 48, UNION, t); // A centre lon
    const [xBMid] = lonLatToCanvas(-86.5,  42, UNION, t); // B centre lon
    // They should be clearly separated — well over half the canvas width apart
    expect(Math.abs(xBMid - xAMid)).toBeGreaterThan(CW * 0.4);
  });

  // Unused import suppression: reference the grid vars so TS/vitest doesn't
  // complain about declared-but-not-used module-level constants.
  it("GRID_A and GRID_B synthetic grids carry correct bbox fields", () => {
    expect(GRID_A.minLon).toBe(-122);
    expect(GRID_B.minLon).toBe(-88);
  });
});
