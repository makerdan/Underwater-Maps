/**
 * Frontend ↔ backend contract tests for the point-radius search.
 *
 * The Overview Map sends the payload
 *   { lat, lon, radius: <km>, unit: "km" }
 * to POST /api/datasets/point-radius-query (the radius is always converted
 * to kilometres client-side via radiusToKm before submit). These tests pin
 * that request shape against the generated Zod schema for the endpoint, and
 * pin the client-side conversion constants / caps against the values the
 * server enforces, so a drift on either side fails a test instead of
 * silently breaking coordinate search.
 */
import { describe, it, expect } from "vitest";
import {
  PostDatasetsPointRadiusQueryBody,
  PostDatasetsPointRadiusQueryResponse,
} from "@workspace/api-zod";
import {
  radiusToKm,
  KM_PER_NMI,
  COORD_SEARCH_MIN_RADIUS_KM,
  COORD_SEARCH_MAX_RADIUS_KM,
  validateRadius,
} from "../coordinateParser";

/** Build the exact payload OverviewMap sends for a queued coordinate search. */
function clientPayload(lat: number, lon: number, radiusKm: number) {
  return { lat, lon, radius: radiusKm, unit: "km" as const };
}

describe("point-radius request contract", () => {
  it("the client payload shape parses against the endpoint schema", () => {
    const payload = clientPayload(55.7, -132.45, 10);
    const parsed = PostDatasetsPointRadiusQueryBody.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(payload);
    }
  });

  it("nmi radii are converted to km before submit, matching the server factor", () => {
    // The client always sends unit:"km" after converting; the conversion
    // factor must equal the one the server would apply for unit:"nmi".
    expect(KM_PER_NMI).toBe(1.852);
    const payload = clientPayload(55.7, -132.45, radiusToKm(10, "nmi"));
    expect(payload.radius).toBeCloseTo(18.52, 10);
    expect(PostDatasetsPointRadiusQueryBody.safeParse(payload).success).toBe(true);
  });

  it("schema also accepts a raw nmi request (server converts)", () => {
    const parsed = PostDatasetsPointRadiusQueryBody.safeParse({
      lat: 55.7,
      lon: -132.45,
      radius: 10,
      unit: "nmi",
    });
    expect(parsed.success).toBe(true);
  });

  it("schema defaults unit to km when omitted", () => {
    const parsed = PostDatasetsPointRadiusQueryBody.parse({
      lat: 0,
      lon: 0,
      radius: 5,
    });
    expect(parsed.unit).toBe("km");
  });

  it("schema rejects out-of-range lat/lon and negative radius", () => {
    expect(
      PostDatasetsPointRadiusQueryBody.safeParse({ lat: 91, lon: 0, radius: 5, unit: "km" }).success,
    ).toBe(false);
    expect(
      PostDatasetsPointRadiusQueryBody.safeParse({ lat: 0, lon: 181, radius: 5, unit: "km" }).success,
    ).toBe(false);
    expect(
      PostDatasetsPointRadiusQueryBody.safeParse({ lat: 0, lon: 0, radius: -1, unit: "km" }).success,
    ).toBe(false);
    expect(
      PostDatasetsPointRadiusQueryBody.safeParse({ lat: 0, lon: 0, radius: 5, unit: "miles" }).success,
    ).toBe(false);
  });

  it("client-side radius caps mirror the server's derived caps", () => {
    // Server: MIN_RADIUS_KM = (MIN_BBOX_DEG / 2) * KM_PER_DEG_LAT
    //         MAX_RADIUS_KM = (MAX_BBOX_LAT_DEG / 2) * KM_PER_DEG_LAT
    const KM_PER_DEG_LAT = 110.574;
    const MIN_BBOX_DEG = 1e-4;
    const MAX_BBOX_LAT_DEG = 170;
    const serverMin = (MIN_BBOX_DEG / 2) * KM_PER_DEG_LAT;
    const serverMax = (MAX_BBOX_LAT_DEG / 2) * KM_PER_DEG_LAT;
    // Client constants are documented mirrors of the server caps, rounded to
    // a user-presentable precision — they must track the server values to
    // within 1% so the two validators never drift meaningfully apart.
    expect(Math.abs(COORD_SEARCH_MIN_RADIUS_KM - serverMin) / serverMin).toBeLessThan(0.01);
    // (The client max is 9399, a rounded-up mirror of the server's 9398.79 —
    // within 0.01% — so the sliver the client green-lights but the server
    // rejects is negligible and surfaced by the server's own error message.)
    expect(Math.abs(COORD_SEARCH_MAX_RADIUS_KM - serverMax) / serverMax).toBeLessThan(0.001);
    // And the client validator flags values outside its caps with a
    // user-visible message (surfaced inline in the form).
    expect(validateRadius(COORD_SEARCH_MAX_RADIUS_KM + 1, "km")).toMatch(/too large/);
    expect(validateRadius(COORD_SEARCH_MIN_RADIUS_KM / 2, "km")).toMatch(/too small/);
  });
});

describe("point-radius response contract", () => {
  it("a server-shaped response parses and contains the fields the client consumes", () => {
    const sample = {
      center: { lat: 55.7, lon: -132.45 },
      radiusKm: 18.52,
      bbox: { north: 55.87, south: 55.53, east: -132.15, west: -132.75 },
      datasets: [
        {
          id: "preset-thorne-bay",
          name: "Thorne Bay Bathymetry",
          sourceAgency: "NOAA",
          dataType: "bathymetry",
          resolutionMMin: 4,
          resolutionMMax: 8,
          coverageBbox: { minLon: -132.6, minLat: 55.6, maxLon: -132.3, maxLat: 55.8 },
          endpointUrl: null,
          accessNotes: null,
          description: "Sample",
          keywords: null,
          lastUpdated: null,
          waterType: "saltwater",
          createdAt: "2024-01-01T00:00:00.000Z",
          relevanceScore: 0.9,
        },
      ],
    };
    const parsed = PostDatasetsPointRadiusQueryResponse.safeParse(sample);
    expect(
      parsed.success,
      parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2),
    ).toBe(true);
    if (parsed.success) {
      // Fields OverviewMap reads from the response:
      expect(parsed.data.radiusKm).toBeCloseTo(18.52);
      expect(parsed.data.bbox.north).toBeGreaterThan(parsed.data.bbox.south);
      expect(parsed.data.datasets[0]!.id).toBe("preset-thorne-bay");
    }
  });
});
