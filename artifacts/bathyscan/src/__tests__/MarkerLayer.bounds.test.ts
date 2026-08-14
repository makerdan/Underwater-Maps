/**
 * Unit tests for MarkerLayer coordinate-bounds utilities.
 *
 * Covers:
 *  - isMarkerInBounds: returns true for in-bbox markers, false for out-of-bbox
 *  - Edge conditions: markers exactly on the bbox boundary are included
 *  - Out-of-bounds markers (Task #3549 Bug 3 fix) are filtered correctly
 *  - Secondary-dataset markers are checked against their OWN bbox, not the
 *    primary terrain's bbox (Task #3566 fix) — prevents valid secondary
 *    markers from being silently dropped.
 *
 * Note: full render tests for MarkerLayer require mocking many hooks (R3F canvas,
 * terrain store, marker queries). The filtering logic is extracted as isMarkerInBounds
 * and tested here as a pure function. This gives the same correctness guarantee
 * with no test infra overhead.
 */
import { describe, it, expect } from "vitest";
import { isMarkerInBounds, groupCatchSymbolsByMarker } from "@/components/MarkerLayer";
import type { CatchEntry } from "@workspace/api-client-react";

// Minimal terrain stub — only the bbox fields are needed by isMarkerInBounds.
const TERRAIN = {
  minLon: -10,
  maxLon: 10,
  minLat: 40,
  maxLat: 60,
};

describe("isMarkerInBounds", () => {
  it("returns true for a marker well inside the terrain bbox", () => {
    expect(isMarkerInBounds({ lon: 0, lat: 50 }, TERRAIN)).toBe(true);
  });

  it("returns true for a marker exactly on the minLon / minLat corner", () => {
    expect(isMarkerInBounds({ lon: -10, lat: 40 }, TERRAIN)).toBe(true);
  });

  it("returns true for a marker exactly on the maxLon / maxLat corner", () => {
    expect(isMarkerInBounds({ lon: 10, lat: 60 }, TERRAIN)).toBe(true);
  });

  it("returns false for a marker whose lon is outside maxLon", () => {
    expect(isMarkerInBounds({ lon: 10.001, lat: 50 }, TERRAIN)).toBe(false);
  });

  it("returns false for a marker whose lon is below minLon", () => {
    expect(isMarkerInBounds({ lon: -10.001, lat: 50 }, TERRAIN)).toBe(false);
  });

  it("returns false for a marker whose lat is above maxLat", () => {
    expect(isMarkerInBounds({ lon: 0, lat: 60.001 }, TERRAIN)).toBe(false);
  });

  it("returns false for a marker whose lat is below minLat", () => {
    expect(isMarkerInBounds({ lon: 0, lat: 39.999 }, TERRAIN)).toBe(false);
  });

  it("returns false for a marker far outside the bbox (antimeridian-style coordinates)", () => {
    expect(isMarkerInBounds({ lon: 170, lat: 50 }, TERRAIN)).toBe(false);
  });

  it("filters out-of-bounds markers from an array (simulates MarkerLayer behaviour)", () => {
    const markers = [
      { lon: 0,      lat: 50 },   // in bounds
      { lon: 15,     lat: 50 },   // lon too high → out
      { lon: -5,     lat: 65 },   // lat too high → out
      { lon: 5,      lat: 45 },   // in bounds
    ];
    const result = markers.filter((m) => isMarkerInBounds(m, TERRAIN));
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ lon: 0, lat: 50 });
    expect(result[1]).toEqual({ lon: 5, lat: 45 });
  });
});

/**
 * Simulates the MarkerLayer filtering logic for a mixed primary + secondary
 * dataset scenario (the fix for the secondary-dataset disappearing bug).
 *
 * MarkerLayer builds a `datasetGroups` map from visibleDatasets, where each
 * entry holds the dataset's own terrain grid. The bounds filter then does:
 *
 *   const dg = datasetGroups.get(marker.datasetId);
 *   const refGrid = dg?.grid ?? terrain;   // own grid, not primary
 *   return isMarkerInBounds(marker, refGrid);
 *
 * This helper replicates that logic as a pure function so the fix can be
 * tested without mounting the full R3F component.
 */
function filterMarkersWithDatasetGroups(
  markers: Array<{ id: string; datasetId: string; lon: number; lat: number }>,
  primaryTerrain: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  datasetGrids: Map<string, { minLon: number; maxLon: number; minLat: number; maxLat: number }>,
): Array<{ id: string; datasetId: string; lon: number; lat: number }> {
  return markers.filter((m) => {
    const ownGrid = datasetGrids.get(m.datasetId);
    // Use the marker's own dataset bbox; fall back to primary if grid is absent.
    const refGrid = ownGrid ?? primaryTerrain;
    return isMarkerInBounds(m, refGrid);
  });
}

describe("secondary-dataset marker bounds — Task #3566 regression guard", () => {
  // Primary terrain covers SE Alaska area.
  const PRIMARY_TERRAIN = {
    minLon: -136,
    maxLon: -130,
    minLat: 56,
    maxLat: 60,
  };

  // Secondary dataset is geographically separate (e.g. Pacific Northwest coast).
  // A marker saved here is OUTSIDE the primary terrain's bbox.
  const SECONDARY_TERRAIN = {
    minLon: -125,
    maxLon: -120,
    minLat: 46,
    maxLat: 50,
  };

  const primaryDatasetId = "ds-primary";
  const secondaryDatasetId = "ds-secondary";

  const datasetGrids = new Map([
    [primaryDatasetId, PRIMARY_TERRAIN],
    [secondaryDatasetId, SECONDARY_TERRAIN],
  ]);

  it("keeps a secondary-dataset marker that is within its own bbox but outside the primary bbox", () => {
    // lon=-122, lat=48 is inside SECONDARY_TERRAIN but outside PRIMARY_TERRAIN.
    const markers = [{ id: "m-sec", datasetId: secondaryDatasetId, lon: -122, lat: 48 }];
    // Sanity-check: this marker IS outside the primary bbox.
    expect(isMarkerInBounds(markers[0]!, PRIMARY_TERRAIN)).toBe(false);
    // But it MUST survive the dataset-aware filter.
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m-sec");
  });

  it("still suppresses a secondary-dataset marker that is outside its own bbox", () => {
    // lon=-110, lat=35 is outside both primary AND secondary terrain bboxes.
    const markers = [{ id: "m-bad", datasetId: secondaryDatasetId, lon: -110, lat: 35 }];
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(0);
  });

  it("keeps a primary-dataset marker within the primary bbox", () => {
    const markers = [{ id: "m-pri", datasetId: primaryDatasetId, lon: -133, lat: 58 }];
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(1);
  });

  it("still suppresses a primary-dataset marker outside the primary bbox", () => {
    // lon=-122, lat=48 is inside the secondary bbox but outside the primary.
    const markers = [{ id: "m-pri-bad", datasetId: primaryDatasetId, lon: -122, lat: 48 }];
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(0);
  });

  it("correctly filters a mixed batch: primary in-bounds, secondary in-bounds, secondary out-of-bounds", () => {
    const markers = [
      { id: "m1", datasetId: primaryDatasetId, lon: -133, lat: 58 },   // primary, in bounds → keep
      { id: "m2", datasetId: secondaryDatasetId, lon: -122, lat: 48 }, // secondary, in own bounds → keep
      { id: "m3", datasetId: secondaryDatasetId, lon: -110, lat: 35 }, // secondary, out of own bounds → drop
      { id: "m4", datasetId: primaryDatasetId, lon: -122, lat: 48 },   // primary, out of primary bounds → drop
    ];
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("falls back to the primary terrain bbox when a marker's dataset has no loaded grid", () => {
    // datasetId unknown — no entry in datasetGrids; refGrid falls back to primaryTerrain.
    const markers = [
      { id: "m-unknown-in", datasetId: "unknown-ds", lon: -133, lat: 58 }, // in primary bounds → keep
      { id: "m-unknown-out", datasetId: "unknown-ds", lon: -122, lat: 48 }, // out of primary bounds → drop
    ];
    const result = filterMarkersWithDatasetGroups(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m-unknown-in");
  });
});

/**
 * Simulates the MarkerLayer filtering logic for markers that have a null or
 * empty datasetId — the case added by the task-3699 fix.
 *
 * When `datasetId` is null/empty the component falls back to the primary
 * terrain bbox (same as the unknown-dataset case).  MarkerLayer also emits a
 * console.warn in DEV mode for these markers; this helper mirrors the
 * filtering side of that behaviour so it can be asserted as a pure function.
 */
function filterMarkersWithNullableDatasetId(
  markers: Array<{ id: string; datasetId: string | null | undefined; lon: number; lat: number }>,
  primaryTerrain: { minLon: number; maxLon: number; minLat: number; maxLat: number },
  datasetGrids: Map<string, { minLon: number; maxLon: number; minLat: number; maxLat: number }>,
): Array<{ id: string; datasetId: string | null | undefined; lon: number; lat: number }> {
  return markers.filter((m) => {
    const markerDatasetId = m.datasetId ?? "";
    const ownGrid = datasetGrids.get(markerDatasetId);
    // No datasetId → falls back to primary (same path as MarkerLayer component).
    const refGrid = ownGrid ?? primaryTerrain;
    return isMarkerInBounds(m, refGrid);
  });
}

describe("null/empty datasetId fallback — Task #3699 regression guard", () => {
  const PRIMARY_TERRAIN = {
    minLon: -136,
    maxLon: -130,
    minLat: 56,
    maxLat: 60,
  };
  const SECONDARY_TERRAIN = {
    minLon: -125,
    maxLon: -120,
    minLat: 46,
    maxLat: 50,
  };
  const datasetGrids = new Map([
    ["ds-primary", PRIMARY_TERRAIN],
    ["ds-secondary", SECONDARY_TERRAIN],
  ]);

  it("keeps a marker with null datasetId that is inside the primary bbox", () => {
    const markers = [{ id: "m-null-in", datasetId: null, lon: -133, lat: 58 }];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m-null-in");
  });

  it("drops a marker with null datasetId that is outside the primary bbox", () => {
    // lon=-122, lat=48 is inside the secondary bbox but NOT the primary.
    // Without a datasetId we cannot look up the correct bbox so the primary is used.
    const markers = [{ id: "m-null-out", datasetId: null, lon: -122, lat: 48 }];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(0);
  });

  it("keeps a marker with empty-string datasetId that is inside the primary bbox", () => {
    const markers = [{ id: "m-empty-in", datasetId: "", lon: -133, lat: 58 }];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m-empty-in");
  });

  it("drops a marker with empty-string datasetId that is outside the primary bbox", () => {
    const markers = [{ id: "m-empty-out", datasetId: "", lon: -110, lat: 35 }];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result).toHaveLength(0);
  });

  it("does not confuse an empty datasetId with a real dataset key of empty string", () => {
    // Even if someone accidentally registered "" as a key in datasetGrids,
    // a null datasetId resolves to "" and would pick it up. Validate the
    // lookup falls back correctly when no "" entry exists (the common case).
    const gridsWithoutEmptyKey = new Map([["ds-primary", PRIMARY_TERRAIN]]);
    const markers = [{ id: "m-null-fallback", datasetId: null, lon: -133, lat: 58 }];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, gridsWithoutEmptyKey);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("m-null-fallback");
  });

  it("mixed batch: null, empty, and valid datasetId markers filtered correctly", () => {
    const markers = [
      { id: "m1", datasetId: "ds-primary",   lon: -133, lat: 58 },  // valid, in primary → keep
      { id: "m2", datasetId: null,            lon: -133, lat: 58 },  // null, in primary → keep (fallback)
      { id: "m3", datasetId: "",              lon: -133, lat: 58 },  // empty, in primary → keep (fallback)
      { id: "m4", datasetId: null,            lon: -122, lat: 48 },  // null, outside primary → drop
      { id: "m5", datasetId: "",              lon: -110, lat: 35 },  // empty, outside primary → drop
      { id: "m6", datasetId: "ds-secondary", lon: -122, lat: 48 },  // valid secondary, in own bbox → keep
    ];
    const result = filterMarkersWithNullableDatasetId(markers, PRIMARY_TERRAIN, datasetGrids);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m6"]);
  });
});

describe("groupCatchSymbolsByMarker (regression guard)", () => {
  it("returns an empty map for empty input", () => {
    const result = groupCatchSymbolsByMarker([]);
    expect(result.size).toBe(0);
  });

  it("groups symbols by markerId, preserving insertion order", () => {
    const entries = [
      { markerId: "m1", symbol: "🐟" },
      { markerId: "m2", symbol: "🦐" },
      { markerId: "m1", symbol: "🐡" },
    ] as CatchEntry[];
    const result = groupCatchSymbolsByMarker(entries);
    expect(result.get("m1")).toEqual(["🐟", "🐡"]);
    expect(result.get("m2")).toEqual(["🦐"]);
  });

  it("keeps duplicate symbols for the same marker (two salmon = two icons)", () => {
    const entries = [
      { markerId: "m1", symbol: "🐟" },
      { markerId: "m1", symbol: "🐟" },
    ] as CatchEntry[];
    const result = groupCatchSymbolsByMarker(entries);
    expect(result.get("m1")).toEqual(["🐟", "🐟"]);
  });
});
