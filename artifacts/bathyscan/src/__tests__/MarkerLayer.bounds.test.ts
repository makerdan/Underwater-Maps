/**
 * Unit tests for MarkerLayer coordinate-bounds utilities.
 *
 * Covers:
 *  - isMarkerInBounds: returns true for in-bbox markers, false for out-of-bbox
 *  - Edge conditions: markers exactly on the bbox boundary are included
 *  - Out-of-bounds markers (Task #3549 Bug 3 fix) are filtered correctly
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
