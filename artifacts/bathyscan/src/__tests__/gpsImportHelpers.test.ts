/**
 * Unit tests for the new gpsImport.ts helpers:
 *   - computeResultBbox
 *   - bboxIntersects
 */
import { describe, it, expect } from "vitest";
import {
  computeResultBbox,
  bboxIntersects,
  normalizeRoutes,
  analyzeRouteLoop,
  closeRouteAtReturnPoint,
  distanceBetweenCoordinates,
  type ParseResult,
  type Bounds,
  type ParsedRoute,
} from "@/lib/gpsImport";

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

  it("preserves a short result bbox across the antimeridian", () => {
    const result: ParseResult = {
      waypoints: [
        { lat: 10, lon: 179, source: "waypoint" },
        { lat: 11, lon: -179, source: "waypoint" },
      ],
      routes: [],
    };
    expect(computeResultBbox(result)).toEqual({
      minLon: 179,
      minLat: 10,
      maxLon: -179,
      maxLat: 11,
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

  it("intersects symmetrically when either box crosses the antimeridian", () => {
    const crossing = { minLon: 170, minLat: -5, maxLon: -170, maxLat: 5 };
    const eastern = { minLon: 175, minLat: -2, maxLon: 179, maxLat: 2 };
    const western = { minLon: -179, minLat: -2, maxLon: -175, maxLat: 2 };
    const outside = { minLon: -20, minLat: -2, maxLon: 20, maxLat: 2 };
    expect(bboxIntersects(crossing, eastern)).toBe(true);
    expect(bboxIntersects(eastern, crossing)).toBe(true);
    expect(bboxIntersects(crossing, western)).toBe(true);
    expect(bboxIntersects(western, crossing)).toBe(true);
    expect(bboxIntersects(crossing, outside)).toBe(false);
    expect(bboxIntersects(outside, crossing)).toBe(false);
  });
});

describe("daily route normalization", () => {
  const track = (points: ParsedRoute["points"]): ParsedRoute => ({
    name: "Survey",
    source: "track",
    points,
  });

  it("splits fully timestamped tracks at UTC calendar midnight", () => {
    const routes = normalizeRoutes([
      track([
        { lat: 1, lon: 2, time: "2026-01-01T23:59:59Z" },
        { lat: 1, lon: 3, time: "2026-01-02T00:00:00Z" },
        { lat: 1, lon: 4, time: "2026-01-02T00:01:00Z" },
      ]),
    ]);
    expect(routes.map((r) => r.name)).toEqual(["Survey — 2026-01-01", "Survey — 2026-01-02"]);
    expect(routes.map((r) => r.points.length)).toEqual([1, 2]);
    expect(routes[0]!.points[0]!.time).toBe("2026-01-01T23:59:59Z");
  });

  it("does not split partially timestamped, invalid, or non-track routes", () => {
    const routes = [
      track([
        { lat: 1, lon: 2, time: "2026-01-01T23:00:00Z" },
        { lat: 1, lon: 3 },
      ]),
      { ...track([{ lat: 1, lon: 2, time: "not-a-time" }]), source: "route" as const },
    ];
    const normalized = normalizeRoutes(routes);
    expect(normalized).toHaveLength(2);
    expect(normalized[0]!.name).toBe("Survey");
    expect(normalized[0]!.points).not.toBe(routes[0]!.points);
  });

  it("detects exact, near, far, short, and dateline-safe loops", () => {
    const exact = track([{ lat: 1, lon: 2 }, { lat: 2, lon: 3 }, { lat: 1, lon: 2 }]);
    expect(analyzeRouteLoop(exact).closingIndex).toBe(2);
    expect(analyzeRouteLoop(track([{ lat: 1, lon: 2 }])).isLoop).toBe(false);
    expect(analyzeRouteLoop(track([{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }])).isLoop).toBe(false);
    expect(analyzeRouteLoop(track([{ lat: 0, lon: 179.9999 }, { lat: 0, lon: -179.9999 }])).isLoop).toBe(true);
    expect(analyzeRouteLoop(track([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])).isLoop).toBe(false);
    expect(distanceBetweenCoordinates({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeLessThan(225_000);
  });

  it("closes at a return point without mutating or duplicating a closed endpoint", () => {
    const route = track([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 0 },
      { lat: 2, lon: 2 },
    ]);
    const closed = closeRouteAtReturnPoint(route);
    expect(closed.points).toHaveLength(3);
    expect(route.points).toHaveLength(4);
    expect(closed.points[2]).toEqual(closed.points[0]);
    expect(closeRouteAtReturnPoint(track([{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }])).points).toHaveLength(2);
  });
});
