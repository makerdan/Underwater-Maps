/**
 * Unit tests for the new gpsImport.ts helpers:
 *   - computeResultBbox
 *   - bboxIntersects
 */
import { describe, it, expect } from "vitest";
import { computeResultBbox, bboxIntersects, type ParseResult, type Bounds } from "@/lib/gpsImport";

// ---------------------------------------------------------------------------
// computeResultBbox
// ---------------------------------------------------------------------------

describe("computeResultBbox", () => {
  it("returns null for an empty result", () => {
    expect(computeResultBbox({ waypoints: [], routes: [] })).toBeNull();
  });

  it("returns the exact coords for a single waypoint", () => {
    const result: ParseResult = {
      waypoints: [{ lat: 45.0, lon: -93.0, source: "waypoint" }],
      routes: [],
    };
    expect(computeResultBbox(result)).toEqual({
      minLon: -93.0,
      minLat: 45.0,
      maxLon: -93.0,
      maxLat: 45.0,
    });
  });

  it("unions waypoints and route points", () => {
    const result: ParseResult = {
      waypoints: [
        { lat: 45.0, lon: -93.0, source: "waypoint" },
        { lat: 46.0, lon: -91.0, source: "waypoint" },
      ],
      routes: [
        {
          name: "Route 1",
          points: [
            { lat: 44.0, lon: -94.0 },
            { lat: 47.0, lon: -90.0 },
          ],
          source: "route",
        },
      ],
    };
    expect(computeResultBbox(result)).toEqual({
      minLon: -94.0,
      minLat: 44.0,
      maxLon: -90.0,
      maxLat: 47.0,
    });
  });

  it("works with only route points (no waypoints)", () => {
    const result: ParseResult = {
      waypoints: [],
      routes: [
        {
          name: "Track",
          points: [
            { lat: 10.0, lon: 20.0 },
            { lat: 11.0, lon: 21.0 },
          ],
          source: "track",
        },
      ],
    };
    expect(computeResultBbox(result)).toEqual({
      minLon: 20.0,
      minLat: 10.0,
      maxLon: 21.0,
      maxLat: 11.0,
    });
  });
});

// ---------------------------------------------------------------------------
// bboxIntersects
// ---------------------------------------------------------------------------

describe("bboxIntersects", () => {
  const base: Bounds = { minLon: -93, minLat: 45, maxLon: -90, maxLat: 48 };

  it("returns true for identical boxes", () => {
    expect(bboxIntersects(base, base)).toBe(true);
  });

  it("returns true for overlapping boxes", () => {
    const overlap: Bounds = { minLon: -92, minLat: 46, maxLon: -89, maxLat: 49 };
    expect(bboxIntersects(base, overlap)).toBe(true);
  });

  it("returns true when one box is fully inside the other", () => {
    const inner: Bounds = { minLon: -92, minLat: 46, maxLon: -91, maxLat: 47 };
    expect(bboxIntersects(base, inner)).toBe(true);
  });

  it("returns true for boxes that share only an edge", () => {
    const touching: Bounds = { minLon: -90, minLat: 45, maxLon: -88, maxLat: 48 };
    expect(bboxIntersects(base, touching)).toBe(true);
    expect(bboxIntersects(touching, base)).toBe(true);
  });

  it("returns true for boxes that share only a corner", () => {
    const corner: Bounds = { minLon: -90, minLat: 48, maxLon: -88, maxLat: 50 };
    expect(bboxIntersects(base, corner)).toBe(true);
  });

  it("returns false when boxes are separated horizontally", () => {
    const east: Bounds = { minLon: -88, minLat: 45, maxLon: -85, maxLat: 48 };
    expect(bboxIntersects(base, east)).toBe(false);
  });

  it("returns false when boxes are separated vertically", () => {
    const north: Bounds = { minLon: -93, minLat: 50, maxLon: -90, maxLat: 53 };
    expect(bboxIntersects(base, north)).toBe(false);
  });

  it("is symmetric", () => {
    const other: Bounds = { minLon: -95, minLat: 43, maxLon: -91, maxLat: 46 };
    expect(bboxIntersects(base, other)).toBe(bboxIntersects(other, base));
  });
});
