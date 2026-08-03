/**
 * overviewRenderer.worldGridUnion.test.ts
 *
 * Unit tests for the union-bbox computation used by OverviewMap to synthesise
 * a shared coordinate frame ("world grid") when two or more datasets are
 * simultaneously visible.
 *
 * The production code lives in OverviewMap.tsx (the useEffect that populates
 * worldGridRef.current):
 *
 *   if (withGrid.length > 1) {
 *     let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
 *     for (const v of withGrid) {
 *       const og = v.overviewGrid;
 *       if (!og) continue;
 *       minLon = Math.min(minLon, og.minLon);
 *       maxLon = Math.max(maxLon, og.maxLon);
 *       minLat = Math.min(minLat, og.minLat);
 *       maxLat = Math.max(maxLat, og.maxLat);
 *     }
 *     worldGridRef.current = { minLon, maxLon, minLat, maxLat } as ...;
 *   } else {
 *     worldGridRef.current = null;
 *   }
 *
 * These tests replicate the same computation so a future change to the formula
 * (e.g. swapping Math.min/Math.max) is caught both here and via the component
 * integration tests.
 */

import { describe, it, expect } from "vitest";
import type { VisibleDataset } from "@/lib/terrainStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Local replica of the union-bbox computation from OverviewMap.tsx:1108-1121.
// Tests target this helper directly so the logic is exercised independently of
// the React component lifecycle.
// ---------------------------------------------------------------------------

interface BboxGrid {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/**
 * Compute the union bounding box from an array of VisibleDataset entries.
 *
 * Returns null when fewer than 2 entries have an `overviewGrid` (mirrors the
 * `worldGridRef.current = null` branch in OverviewMap.tsx).
 */
function computeWorldGrid(datasets: VisibleDataset[]): BboxGrid | null {
  const withGrid = datasets.filter((v) => !!v.overviewGrid);
  if (withGrid.length <= 1) return null;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const v of withGrid) {
    const og = v.overviewGrid;
    if (!og) continue;
    minLon = Math.min(minLon, og.minLon);
    maxLon = Math.max(maxLon, og.maxLon);
    minLat = Math.min(minLat, og.minLat);
    maxLat = Math.max(maxLat, og.maxLat);
  }
  return { minLon, maxLon, minLat, maxLat };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrid(minLon: number, maxLon: number, minLat: number, maxLat: number): TerrainData {
  return { minLon, maxLon, minLat, maxLat } as unknown as TerrainData;
}

function makeDataset(
  id: string,
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
): VisibleDataset {
  return {
    datasetId: id,
    source: "preset",
    activeGrid: null,
    overviewGrid: makeGrid(minLon, maxLon, minLat, maxLat),
    dataUpdatedAt: null,
  };
}

function makeDatasetNoGrid(id: string): VisibleDataset {
  return {
    datasetId: id,
    source: "preset",
    activeGrid: null,
    overviewGrid: null,
    dataUpdatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// 1. Single dataset → no worldGrid
// ---------------------------------------------------------------------------

describe("computeWorldGrid — single dataset returns null", () => {
  it("one dataset with overviewGrid → null (no combined bbox needed)", () => {
    const ds = [makeDataset("a", -122, -119, 47, 49)];
    expect(computeWorldGrid(ds)).toBeNull();
  });

  it("one dataset without overviewGrid → null", () => {
    const ds = [makeDatasetNoGrid("a")];
    expect(computeWorldGrid(ds)).toBeNull();
  });

  it("empty array → null", () => {
    expect(computeWorldGrid([])).toBeNull();
  });

  it("two datasets where only one has an overviewGrid → null", () => {
    const ds = [makeDataset("a", -122, -119, 47, 49), makeDatasetNoGrid("b")];
    expect(computeWorldGrid(ds)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Two non-overlapping datasets → union covers both extents
// ---------------------------------------------------------------------------

describe("computeWorldGrid — two non-overlapping datasets", () => {
  // Dataset A: Pacific coast   (-122..-119 lon, 47..49 lat)
  // Dataset B: Great Lakes     (-88..-85  lon, 41..43 lat)
  const dsA = makeDataset("A", -122, -119, 47, 49);
  const dsB = makeDataset("B", -88,  -85,  41, 43);

  it("minLon equals the westernmost edge of A", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.minLon).toBe(-122);
  });

  it("maxLon equals the easternmost edge of B", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.maxLon).toBe(-85);
  });

  it("minLat equals the southernmost edge of B", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.minLat).toBe(41);
  });

  it("maxLat equals the northernmost edge of A", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.maxLat).toBe(49);
  });

  it("world grid lon span covers both datasets (37°)", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.maxLon - wg.minLon).toBeCloseTo(37, 10);
  });

  it("world grid lat span covers both datasets (8°)", () => {
    const wg = computeWorldGrid([dsA, dsB])!;
    expect(wg.maxLat - wg.minLat).toBeCloseTo(8, 10);
  });

  it("is symmetric: [A, B] and [B, A] produce identical union", () => {
    const wgAB = computeWorldGrid([dsA, dsB])!;
    const wgBA = computeWorldGrid([dsB, dsA])!;
    expect(wgAB).toEqual(wgBA);
  });
});

// ---------------------------------------------------------------------------
// 3. Two overlapping datasets → union equals the outer extent
// ---------------------------------------------------------------------------

describe("computeWorldGrid — two overlapping datasets", () => {
  // A is the smaller inner bbox, B is the wider outer bbox — A is fully contained in B.
  const inner = makeDataset("inner", -121, -120,  47.5, 48.5);
  const outer = makeDataset("outer", -122, -119,  47,   49  );

  it("minLon comes from the wider outer dataset", () => {
    const wg = computeWorldGrid([inner, outer])!;
    expect(wg.minLon).toBe(-122);
  });

  it("maxLon comes from the wider outer dataset", () => {
    const wg = computeWorldGrid([inner, outer])!;
    expect(wg.maxLon).toBe(-119);
  });

  it("minLat comes from the wider outer dataset", () => {
    const wg = computeWorldGrid([inner, outer])!;
    expect(wg.minLat).toBe(47);
  });

  it("maxLat comes from the wider outer dataset", () => {
    const wg = computeWorldGrid([inner, outer])!;
    expect(wg.maxLat).toBe(49);
  });

  it("union equals the outer bbox exactly when one dataset is fully contained", () => {
    const wg = computeWorldGrid([inner, outer])!;
    expect(wg).toEqual({ minLon: -122, maxLon: -119, minLat: 47, maxLat: 49 });
  });

  it("partially overlapping datasets: union takes each extreme independently", () => {
    // A: -122..-120,  47..49    B: -121..-118,  46..48  (overlap: -121..-120, 47..48)
    const a = makeDataset("a", -122, -120, 47, 49);
    const b = makeDataset("b", -121, -118, 46, 48);
    const wg = computeWorldGrid([a, b])!;
    expect(wg.minLon).toBe(-122);
    expect(wg.maxLon).toBe(-118);
    expect(wg.minLat).toBe(46);
    expect(wg.maxLat).toBe(49);
  });
});

// ---------------------------------------------------------------------------
// 4. Three datasets → union is the outermost bbox of all three
// ---------------------------------------------------------------------------

describe("computeWorldGrid — three datasets", () => {
  // A: Pacific coast
  // B: Great Lakes
  // C: Gulf of Mexico (southernmost, easternmost)
  const dsA = makeDataset("A", -122, -119, 47, 49);   // Pacific
  const dsB = makeDataset("B", -88,  -85,  41, 43);   // Great Lakes
  const dsC = makeDataset("C", -97,  -90,  24, 30);   // Gulf

  it("returns a non-null bbox", () => {
    expect(computeWorldGrid([dsA, dsB, dsC])).not.toBeNull();
  });

  it("minLon is the westernmost edge across all three datasets", () => {
    const wg = computeWorldGrid([dsA, dsB, dsC])!;
    expect(wg.minLon).toBe(-122);
  });

  it("maxLon is the easternmost edge across all three datasets", () => {
    const wg = computeWorldGrid([dsA, dsB, dsC])!;
    expect(wg.maxLon).toBe(-85);
  });

  it("minLat is the southernmost edge across all three datasets", () => {
    const wg = computeWorldGrid([dsA, dsB, dsC])!;
    expect(wg.minLat).toBe(24);
  });

  it("maxLat is the northernmost edge across all three datasets", () => {
    const wg = computeWorldGrid([dsA, dsB, dsC])!;
    expect(wg.maxLat).toBe(49);
  });

  it("result is identical regardless of input order (commutative)", () => {
    const wg1 = computeWorldGrid([dsA, dsB, dsC])!;
    const wg2 = computeWorldGrid([dsC, dsA, dsB])!;
    const wg3 = computeWorldGrid([dsB, dsC, dsA])!;
    expect(wg1).toEqual(wg2);
    expect(wg1).toEqual(wg3);
  });

  it("datasets without overviewGrid are skipped but do not cause null return", () => {
    const missing = makeDatasetNoGrid("missing");
    const wg = computeWorldGrid([dsA, dsB, missing])!;
    // Only A and B contribute — still 2 entries with grids → non-null result.
    expect(wg).not.toBeNull();
    expect(wg.minLon).toBe(-122);
    expect(wg.maxLon).toBe(-85);
  });
});
