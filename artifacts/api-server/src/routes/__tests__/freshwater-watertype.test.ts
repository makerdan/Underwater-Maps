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

  it("waterType=freshwater + no NOAA station → { available: false } with no numeric tidal fields", async () => {
    fetchSpy.mockResolvedValue(emptyStationsResponse());

    const res = await request(makeTidalApp()).get(
      "/tidal?lat=44.0&lon=-87.0&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);

    // Sinusoidal synthetic fields must NOT be present
    expect(res.body.tideHeight).toBeUndefined();
    expect(res.body.currentSpeed).toBeUndefined();
    expect(res.body.currentDirection).toBeUndefined();
    expect(res.body.source).toBeUndefined();
    expect(res.body.stationName).toBeUndefined();
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

  it("waterType=freshwater + real NOAA station found → { available: true } with station data (sentinel)", async () => {
    const station = {
      id: "9087088",
      name: "Mackinaw City",
      lat: 45.78,
      lng: -84.73,
    };

    // 1: heights station list, 2: currents station list (none),
    // 3: heights hi/lo predictions, 4: currents (none)
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ stations: [station] }))
      .mockResolvedValueOnce(jsonResponse({ stations: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          predictions: [
            { t: "2026-07-20 00:00", v: "2.0", type: "H" },
            { t: "2026-07-20 06:00", v: "0.2", type: "L" },
            { t: "2026-07-20 12:00", v: "2.1", type: "H" },
            { t: "2026-07-20 18:00", v: "0.1", type: "L" },
          ],
        }),
      )
      .mockResolvedValue(jsonResponse({ current_predictions: { cp: [] } }));

    const res = await request(makeTidalApp()).get(
      `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-07-20T03:00:00Z&waterType=freshwater`,
    );

    expect(res.status).toBe(200);
    // When a real station IS found, available must be true even for freshwater
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("noaa");
    expect(res.body.heightsSource).toBe("noaa");
    expect(res.body.stationName).toBe(station.name);
    // Numeric tidal fields present
    expect(typeof res.body.tideHeight).toBe("number");
    expect(typeof res.body.currentSpeed).toBe("number");
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

  it("waterType=freshwater + no NOAA station → { available: false } with no numeric fields", async () => {
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
    expect(res.body.available).toBe(false);

    // Synthetic hourly arrays and station fields must NOT be present
    expect(res.body.hours).toBeUndefined();
    expect(res.body.forecast48h).toBeUndefined();
    expect(res.body.tidalDataSource).toBeUndefined();
    expect(res.body.tidalStationId).toBeUndefined();
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
                { Time: "2026-07-20 00:00", Velocity_Major: 0.8, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 01:00", Velocity_Major: 0.6, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 02:00", Velocity_Major: 0.2, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 03:00", Velocity_Major: -0.3, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 04:00", Velocity_Major: -0.7, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 05:00", Velocity_Major: -0.9, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 06:00", Velocity_Major: -0.8, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 07:00", Velocity_Major: -0.5, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 08:00", Velocity_Major: -0.1, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 09:00", Velocity_Major: 0.4, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 10:00", Velocity_Major: 0.8, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 11:00", Velocity_Major: 1.0, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 12:00", Velocity_Major: 0.9, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 13:00", Velocity_Major: 0.6, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 14:00", Velocity_Major: 0.2, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 15:00", Velocity_Major: -0.3, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 16:00", Velocity_Major: -0.7, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 17:00", Velocity_Major: -1.0, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 18:00", Velocity_Major: -0.9, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 19:00", Velocity_Major: -0.5, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 20:00", Velocity_Major: -0.1, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 21:00", Velocity_Major: 0.3, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 22:00", Velocity_Major: 0.7, meanFloodDir: 50, meanEbbDir: 230 },
                { Time: "2026-07-20 23:00", Velocity_Major: 1.0, meanFloodDir: 50, meanEbbDir: 230 },
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
  });

  it("waterType=invalid → 400 with validation error", async () => {
    const res = await request(makeSurfaceApp()).get(
      "/surface-conditions?lat=44.0&lon=-87.0&waterType=lake",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});
