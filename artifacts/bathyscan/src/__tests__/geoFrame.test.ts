import { describe, expect, it } from "vitest";
import {
  geoBoundsCenter,
  geoBoundsContains,
  longitudeSpan,
  projectGeoPoint,
  unionGeoBounds,
  unprojectGeoPoint,
} from "@workspace/shared-types";

describe("canonical geographic frame", () => {
  it("round-trips north-up points across the antimeridian", () => {
    const bounds = { minLon: 170, maxLon: -170, minLat: -10, maxLat: 10 };
    const canvas = projectGeoPoint({ lon: -175, lat: 5 }, bounds, 200, 100);
    expect(canvas).toEqual({ x: 150, y: 25 });
    expect(unprojectGeoPoint(canvas, bounds, 200, 100)).toEqual({ lon: -175, lat: 5 });
  });

  it("unions dateline bounds independently of input order", () => {
    const west = { minLon: 170, maxLon: -175, minLat: 0, maxLat: 5 };
    const east = { minLon: -179, maxLon: -165, minLat: -2, maxLat: 8 };
    const expected = unionGeoBounds([west, east]);
    expect(expected).toEqual(unionGeoBounds([east, west]));
    expect(expected).toMatchObject({ minLon: 170, maxLon: -165, minLat: -2, maxLat: 8 });
    expect(longitudeSpan(expected!)).toBe(25);
  });

  it("keeps a loaded secondary from dropping an unloaded primary", () => {
    const primary = { minLon: 170, maxLon: -175, minLat: 0, maxLat: 5 };
    const secondary = { minLon: -120, maxLon: -115, minLat: 10, maxLat: 15 };
    const frame = unionGeoBounds([primary, secondary]);
    expect(frame).not.toBeNull();
    expect(geoBoundsContains(frame!, { lon: 172, lat: 2 })).toBe(true);
    expect(geoBoundsContains(frame!, { lon: -118, lat: 12 })).toBe(true);
  });

  it("uses the continuous center for a wrapped interval", () => {
    expect(geoBoundsCenter({ minLon: 170, maxLon: -170, minLat: 0, maxLat: 10 }))
      .toEqual({ lon: -180, lat: 5 });
  });
});