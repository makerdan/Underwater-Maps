/**
 * freshwater-watertype.test.ts — Regression guards for freshwater gating in
 * /api/tidal and /api/surface-conditions.
 *
 * @tag freshwater-env
 *
 * Freshwater gating contract:
 *   1. waterType=freshwater + no real station → { available: false } with no
 *      numeric tidal/current fields (sinusoidal model must NOT be served for
 *      inland freshwater bodies).
 *   2. waterType=saltwater + no real station → { available: true } with
 *      sinusoidal data (existing coastal fallback preserved).
 *   3. waterType=freshwater + real NOAA station found (sentinel pass-through) →
 *      { available: true } with real station data flowing through.
 *   4. buildSinusoidalTidalHours unit tests lock in the ((lat+lon)*73.1)
 *      bearing heuristic so a silent formula change fails a test immediately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import surfaceConditionsRouter, {
  buildSinusoidalTidalHours,
  _resetNoaaStationCacheForTests,
} from "../surface-conditions";

import tidalRouter, {
  __clearStationListCachesForTests,
  __clearHighLowEventsCacheForTests,
} from "../tidal";

function makeSurfaceApp() {
  const app = express();
  app.use(surfaceConditionsRouter);
  return app;
}

function makeTidalApp() {
  const app = express();
  app.use(tidalRouter);
  return app;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function emptyStationsResponse(): Response {
  return jsonResponse({ stations: [] });
}

function emptyOpenMeteoResponse(): Response {
  return jsonResponse({
    hourly: {
      wind_speed_10m: Array(48).fill(10),
      wind_direction_10m: Array(48).fill(225),
    },
  });
}

function emptyMarineResponse(): Response {
  return jsonResponse({
    hourly: {
      wave_height: Array(48).fill(0.3),
      wave_direction: Array(48).fill(270),
    },
  });
}

// ── buildSinusoidalTidalHours unit tests ──────────────────────────────────────

describe("buildSinusoidalTidalHours — heuristic bearing regression guard [freshwater-env]", () => {
  it("returns 24 entries with valid speed and phase values", () => {
    const hrs = buildSinusoidalTidalHours(44.0, -87.0);
    expect(hrs).toHaveLength(24);
    for (const h of hrs) {
      expect(h.tidalSpeedKnots).toBeGreaterThanOrEqual(0);
      expect(h.tidalSpeedKnots).toBeLessThanOrEqual(1.2);
      // JS % can yield negative values; abs is correct
      expect(Math.abs(h.tidalDegrees)).toBeLessThan(360);
    }
  });

  it("all 24 phase values are valid TidePhase strings", () => {
    const valid = new Set(["flooding", "ebbing", "slack-high", "slack-low"]);
    const hrs = buildSinusoidalTidalHours(44.0, -87.0);
    for (const h of hrs) {
      expect(valid.has(h.phase)).toBe(true);
    }
  });

  it("((lat+lon)*73.1) heuristic: same lat+lon sum → same tidalDegrees in flooding hours", () => {
    // Two coordinate pairs with the same (lat + lon) sum must produce the same
    // flood bearing. Formula: floodBearing = ((lat+lon)*73.1 + 360) % 360.
    const start = 1_700_000_000_000;
    const hrs1 = buildSinusoidalTidalHours(44.0, -86.0, start); // sum = -42
    const hrs2 = buildSinusoidalTidalHours(40.0, -82.0, start); // sum = -42

    const flooding1 = hrs1.filter((h) => h.phase === "flooding");
    const flooding2 = hrs2.filter((h) => h.phase === "flooding");

    expect(flooding1.length).toBeGreaterThan(0);
    expect(flooding2.length).toBeGreaterThan(0);
    // Same sum → same flood bearing
    expect(flooding1[0]!.tidalDegrees).toBe(flooding2[0]!.tidalDegrees);
  });

  it("different lat+lon sums → different tidalDegrees in flooding hours", () => {
    const start = 1_700_000_000_000;
    const hrs1 = buildSinusoidalTidalHours(44.0, -87.0, start); // sum = -43
    const hrs2 = buildSinusoidalTidalHours(44.0, -80.0, start); // sum = -36

    const flooding1 = hrs1.filter((h) => h.phase === "flooding");
    const flooding2 = hrs2.filter((h) => h.phase === "flooding");

    if (flooding1.length > 0 && flooding2.length > 0) {
      expect(flooding1[0]!.tidalDegrees).not.toBe(flooding2[0]!.tidalDegrees);
    }
  });
});

// ── GET /tidal freshwater gating tests ───────────────────────────────────────

describe("GET /tidal — freshwater gating [freshwater-env]", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __clearStationListCachesForTests();
    __clearHighLowEventsCacheForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("waterType=freshwater + no compatible observation → unavailable without numeric tidal data", async () => {
    fetchSpy.mockResolvedValue(emptyStationsResponse());

    const res = await request(makeTidalApp()).get(
      "/tidal?lat=44.0&lon=-87.0&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.source).toBe("unavailable");
    expect(res.body.unavailableReason).toBe("freshwater_no_compatible_observation");
    expect(res.body.tideHeight).toBeUndefined();
    expect(res.body.currentSpeed).toBeUndefined();
  });

  it("waterType=saltwater + no NOAA station → { available: true } with sinusoidal fallback", async () => {
    fetchSpy.mockResolvedValue(emptyStationsResponse());

    const res = await request(makeTidalApp()).get(
      "/tidal?lat=44.0&lon=-87.0&datetime=2026-07-20T12:00:00Z&waterType=saltwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
    expect(typeof res.body.tideHeight).toBe("number");
    expect(typeof res.body.currentSpeed).toBe("number");
  });

  it("no waterType param + no NOAA station → { available: true } (existing fallback unchanged)", async () => {
    fetchSpy.mockResolvedValue(emptyStationsResponse());

    const res = await request(makeTidalApp()).get(
      "/tidal?lat=44.0&lon=-87.0&datetime=2026-07-20T12:00:00Z",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
  });

  it("waterType=freshwater + Great Lakes coordinates never uses a local GLERL sinusoid", async () => {
    fetchSpy.mockResolvedValue(emptyStationsResponse());
    const res = await request(makeTidalApp()).get(
      `/tidal?lat=45.78&lon=-84.73&datetime=2026-07-20T03:00:00Z&waterType=freshwater`,
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.source).toBe("unavailable");
    expect(res.body.tideHeight).toBeUndefined();
    expect(res.body.currentSpeed).toBeUndefined();
  });

  it("waterType=invalid → 400 with validation error", async () => {
    const res = await request(makeTidalApp()).get(
      "/tidal?lat=44.0&lon=-87.0&datetime=2026-07-20T12:00:00Z&waterType=brackish",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });
});

// ── GET /surface-conditions freshwater gating tests ──────────────────────────

describe("GET /surface-conditions — freshwater gating [freshwater-env]", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    _resetNoaaStationCacheForTests();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("waterType=freshwater + no NOAA station retains weather but omits fabricated tides", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("tidesandcurrents.noaa.gov")) {
        return Promise.resolve(emptyStationsResponse());
      }
      if (String(url).includes("marine-api.open-meteo.com")) {
        return Promise.resolve(emptyMarineResponse());
      }
      return Promise.resolve(emptyOpenMeteoResponse());
    });

    const res = await request(makeSurfaceApp()).get(
      "/surface-conditions?lat=44.0&lon=-87.0&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.tidalAvailable).toBe(false);
    expect(res.body.tidalDataSource).toBe("unavailable");
    expect(res.body.hours[0].windSpeedKnots).toBe(10);
    expect(res.body.hours[0].waveHeightM).toBe(0.3);
    expect(res.body.hours[0].tidalSpeedKnots).toBeUndefined();
    expect(res.body.forecast48h[0].tidalSpeedKnots).toBeUndefined();
    expect(Array.isArray(res.body.hours)).toBe(true);
  });

  it("waterType=saltwater + no NOAA station → { available: true } with tidalDataSource:sinusoidal", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("tidesandcurrents.noaa.gov")) {
        return Promise.resolve(emptyStationsResponse());
      }
      if (String(url).includes("marine-api.open-meteo.com")) {
        return Promise.resolve(emptyMarineResponse());
      }
      return Promise.resolve(emptyOpenMeteoResponse());
    });

    const res = await request(makeSurfaceApp()).get(
      "/surface-conditions?lat=44.0&lon=-87.0&waterType=saltwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.tidalDataSource).toBe("sinusoidal");
    expect(Array.isArray(res.body.hours)).toBe(true);
    expect(res.body.hours).toHaveLength(24);
  });

  it("no waterType + no NOAA station → { available: true } (existing behaviour unchanged)", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("tidesandcurrents.noaa.gov")) {
        return Promise.resolve(emptyStationsResponse());
      }
      if (String(url).includes("marine-api.open-meteo.com")) {
        return Promise.resolve(emptyMarineResponse());
      }
      return Promise.resolve(emptyOpenMeteoResponse());
    });

    const res = await request(makeSurfaceApp()).get(
      "/surface-conditions?lat=44.0&lon=-87.0",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.tidalDataSource).toBe("sinusoidal");
  });

  it("waterType=freshwater + NOAA station found → { available: true } (sentinel pass-through)", async () => {
    const now = new Date();
    const datePrefix = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
    ].join("-");
    const station = {
      id: "9087088",
      name: "Mackinaw City",
      lat: 45.78,
      lng: -84.73,
    };

    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      // surface-conditions calls fetchNoaaStations() which uses:
      //   …stations.json?type=currentpredictions  (tidal current stations)
      //   …stations.json?type=waterlevels         (tide height stations)
      // and fetchNoaaPredictions() which uses …/api/prod/datagetter
      if (u.includes("type=currentpredictions") || u.includes("type=waterlevels")) {
        return Promise.resolve(jsonResponse({ stations: [station] }));
      }
      if (u.includes("datagetter")) {
        // fetchNoaaPredictions expects current_predictions.cp shape.
        return Promise.resolve(
          jsonResponse({
            current_predictions: {
              cp: [
                ...Array.from({ length: 24 }, (_, hour) => ({
                  Time: `${datePrefix} ${String(hour).padStart(2, "0")}:00`,
                  Velocity_Major: hour < 12 ? 0.8 : -0.8,
                  meanFloodDir: 50,
                  meanEbbDir: 230,
                })),
              ],
            },
          }),
        );
      }
      if (u.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(emptyMarineResponse());
      }
      return Promise.resolve(emptyOpenMeteoResponse());
    });

    const res = await request(makeSurfaceApp()).get(
      `/surface-conditions?lat=${station.lat}&lon=${station.lng}&waterType=freshwater`,
    );

    expect(res.status).toBe(200);
    // When a real NOAA station is found, freshwater gating must NOT block.
    expect(res.body.available).toBe(true);
    expect(res.body.tidalAvailable).toBe(true);
    expect(res.body.tidalDataSource).toBe("noaa-coops");
    expect(res.body.forecast48h[24].tidalSpeedKnots).toBeUndefined();
  });

  it("waterType=invalid → 400 with validation error", async () => {
    const res = await request(makeSurfaceApp()).get(
      "/surface-conditions?lat=44.0&lon=-87.0&waterType=lake",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});
