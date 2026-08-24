/**
 * puzzleTransform.test.ts
 *
 * Unit tests for applyPuzzleTransformToLonLat and tileCenterLonLat.
 * These are pure functions with no React or Three.js dependencies.
 */
import { describe, it, expect } from "vitest";
import type { TerrainData } from "@workspace/api-client-react";
import {
  applyPuzzleTransformToLonLat,
  rebasePuzzleTransformsForView,
  tileCenterLonLat,
} from "../puzzleTransform";
import type { PuzzleTransform } from "../puzzleStore";
import type { OverviewTransform } from "../overviewRenderer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal TerrainData containing only the bbox fields used by the projection. */
function makeGrid(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
): TerrainData {
  return {
    minLon,
    maxLon,
    minLat,
    maxLat,
    width: 2,
    height: 2,
    resolution: 2,
    depths: [10, 10, 10, 10],
    minDepth: 10,
    maxDepth: 10,
  } as unknown as TerrainData;
}

/**
 * Simple transform: 1 px per degree, no pan.
 * canvas X = lon, canvas Y = 1 - lat  (for a 0–1 lon, 0–1 lat grid)
 */
function makeTransform(pxPerDeg = 100, scale = 1, offsetX = 0, offsetY = 0): OverviewTransform {
  return { pxPerDeg, scale, offsetX, offsetY };
}

// ---------------------------------------------------------------------------
// tileCenterLonLat
// ---------------------------------------------------------------------------

describe("tileCenterLonLat", () => {
  it("returns the midpoint for a normal bbox", () => {
    const { centerLon, centerLat } = tileCenterLonLat({
      minLon: -10,
      maxLon: 10,
      minLat: 20,
      maxLat: 40,
    });
    expect(centerLon).toBeCloseTo(0);
    expect(centerLat).toBeCloseTo(30);
  });

  it("handles antimeridian-crossing bboxes correctly", () => {
    // minLon=170, maxLon=-170 → spans 20° and centre is at 180° = -180°
    const { centerLon, centerLat } = tileCenterLonLat({
      minLon: 170,
      maxLon: -170,
      minLat: 0,
      maxLat: 10,
    });
    // 170 + 20/2 = 180 → wrapped to -180 or 180, both are valid
    expect(Math.abs(centerLon)).toBeCloseTo(180, 1);
    expect(centerLat).toBeCloseTo(5);
  });
});

// ---------------------------------------------------------------------------
// applyPuzzleTransformToLonLat
// ---------------------------------------------------------------------------

describe("applyPuzzleTransformToLonLat — identity (no transform)", () => {
  it("returns original lon/lat when tx=ty=angleDeg=0", () => {
    const grid = makeGrid(-20, 20, -20, 20);
    const t = makeTransform(100, 1, 0, 0);
    const result = applyPuzzleTransformToLonLat(
      5, 3,       // marker lon, lat
      0, 0,       // tile centre lon, lat
      { tx: 0, ty: 0, angleDeg: 0 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(5, 6);
    expect(result.lat).toBeCloseTo(3, 6);
  });
});

describe("applyPuzzleTransformToLonLat — pure translation", () => {
  it("shifts lon/lat correctly for positive tx (rightward canvas shift)", () => {
    // Grid: lon [-20, 20] (40°), lat [-20, 20] (40°). pxPerDeg=100, scale=1.
    // terrainW = 100*40 = 4000 px, terrainH = 4000 px.
    // tx = 100 px → dLon = 100/4000*40 = 1°
    const grid = makeGrid(-20, 20, -20, 20);
    const t = makeTransform(100, 1, 0, 0);
    const result = applyPuzzleTransformToLonLat(
      5, 3,
      0, 0,       // tile centre at origin
      { tx: 100, ty: 0, angleDeg: 0 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(6, 4);   // 5 + 1
    expect(result.lat).toBeCloseTo(3, 4);   // unchanged
  });

  it("shifts lat correctly for positive ty (downward canvas shift = southward)", () => {
    // ty = 100 px → dLat = -100/4000*40 = -1°  (canvas Y down = lat decreasing)
    const grid = makeGrid(-20, 20, -20, 20);
    const t = makeTransform(100, 1, 0, 0);
    const result = applyPuzzleTransformToLonLat(
      5, 3,
      0, 0,
      { tx: 0, ty: 100, angleDeg: 0 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(5, 4);   // unchanged
    expect(result.lat).toBeCloseTo(2, 4);   // 3 - 1
  });
});

describe("applyPuzzleTransformToLonLat — pure rotation around tile centre", () => {
  it("rotates 90° clockwise: a point directly north of centre moves to the east", () => {
    // Marker is 1° north of the tile centre. After 90° CW rotation it should
    // be 1° east of the centre.
    // Use a large grid so 1° displacement is many canvas pixels (numerical precision).
    const grid = makeGrid(-50, 50, -50, 50);  // 100° × 100°, pxPerDeg=10
    const t = makeTransform(10, 1, 0, 0);

    // Tile centre at (0, 0). Marker at (0, 1) — 1° north.
    // 90° CW in canvas space (y-down): +90° rotation moves (0, -1) canvas offset → (+1, 0).
    // dLon = +1° (east), dLat = 0°.
    const result = applyPuzzleTransformToLonLat(
      0, 1,       // marker: 1° north of centre
      0, 0,       // tile centre
      { tx: 0, ty: 0, angleDeg: 90 },
      grid,
      t,
    );
    // After 90° CW: (0, 1) north → (1, 0) east
    expect(result.lon).toBeCloseTo(1, 3);
    expect(result.lat).toBeCloseTo(0, 3);
  });

  it("rotates 180°: point north of centre moves to south", () => {
    const grid = makeGrid(-50, 50, -50, 50);
    const t = makeTransform(10, 1, 0, 0);
    const result = applyPuzzleTransformToLonLat(
      0, 2,       // 2° north of centre
      0, 0,
      { tx: 0, ty: 0, angleDeg: 180 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(0, 3);
    expect(result.lat).toBeCloseTo(-2, 3);  // 2° south
  });
});

describe("applyPuzzleTransformToLonLat — combined translate + rotate", () => {
  it("applies rotation then translation independently", () => {
    // Marker at tile centre → rotation has no effect, only translation matters.
    const grid = makeGrid(-50, 50, -50, 50);
    const t = makeTransform(10, 1, 0, 0);
    // terrainW = 10 * 100 = 1000 px; tx=10 px → 10/1000*100 = 1° lon shift
    const result = applyPuzzleTransformToLonLat(
      0, 0,       // marker at tile centre — rotation is a no-op here
      0, 0,
      { tx: 10, ty: 0, angleDeg: 45 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(1, 3);   // translated 1° east
    expect(result.lat).toBeCloseTo(0, 3);   // no north/south shift
  });
});

describe("applyPuzzleTransformToLonLat — null-transform passthrough", () => {
  it("is equivalent to identity when both tx=ty=angleDeg=0 regardless of tile centre", () => {
    const grid = makeGrid(-10, 10, -10, 10);
    const t = makeTransform(50, 1, 0, 0);
    const result = applyPuzzleTransformToLonLat(
      3.5, -2.1,
      5, 5,   // arbitrary tile centre, doesn't matter for identity
      { tx: 0, ty: 0, angleDeg: 0 },
      grid,
      t,
    );
    expect(result.lon).toBeCloseTo(3.5, 6);
    expect(result.lat).toBeCloseTo(-2.1, 6);
  });
});

describe("rebasePuzzleTransformsForView", () => {
  it("preserves geographic displacement across zoom in and out", () => {
    const original = new Map<string, PuzzleTransform>([
      ["tile", { tx: 40, ty: -20, angleDeg: 37, flipH: true, flipV: false }],
    ]);
    const zoomed = rebasePuzzleTransformsForView(original, 100, 250);
    expect(zoomed.get("tile")).toMatchObject({ tx: 100, ty: -50, angleDeg: 37, flipH: true });
    const restored = rebasePuzzleTransformsForView(zoomed, 250, 100);
    expect(restored.get("tile")?.tx).toBeCloseTo(40);
    expect(restored.get("tile")?.ty).toBeCloseTo(-20);
  });

  it("does not mutate the input map or non-positional transform fields", () => {
    const original = new Map<string, PuzzleTransform>([
      ["tile", { tx: 10, ty: 15, angleDeg: 90, flipH: false, flipV: true, locked: true }],
    ]);
    const rebased = rebasePuzzleTransformsForView(original, 2, 3);
    expect(original.get("tile")).toMatchObject({ tx: 10, ty: 15 });
    expect(rebased.get("tile")).toMatchObject({
      tx: 15, ty: 22.5, angleDeg: 90, flipH: false, flipV: true, locked: true,
    });
  });
});
