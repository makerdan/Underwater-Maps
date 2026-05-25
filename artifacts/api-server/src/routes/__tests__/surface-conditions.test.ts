import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import surfaceConditionsRouter, {
  buildSinusoidalTidalHours,
  haversineKm,
  findNearestStation,
  parseNoaaPredictions,
  _resetNoaaStationCacheForTests,
} from "../surface-conditions";

function makeApp() {
  const app = express();
  app.use(surfaceConditionsRouter);
  return app;
}

const NOAA_STATIONS_URL =
  "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions";
const NOAA_PREDICTIONS_HOST = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm(40.7, -74.0, 40.7, -74.0)).toBeCloseTo(0, 5);
  });

  it("computes NYC ↔ Boston ≈ 306 km", () => {
    const d = haversineKm(40.7128, -74.006, 42.3601, -71.0589);
    expect(d).toBeGreaterThan(290);
    expect(d).toBeLessThan(320);
  });
});

describe("buildSinusoidalTidalHours", () => {
  it("returns 24 entries with bounded speed", () => {
    const hrs = buildSinusoidalTidalHours(40, -74);
    expect(hrs).toHaveLength(24);
    for (const h of hrs) {
      expect(h.tidalSpeedKnots).toBeGreaterThanOrEqual(0);
      expect(h.tidalSpeedKnots).toBeLessThanOrEqual(1.2);
      expect(Math.abs(h.tidalDegrees)).toBeLessThan(360);
    }
  });
});

describe("findNearestStation", () => {
  const stations = [
    { id: "A", name: "Alpha", lat: 40.5, lng: -74.0 },
    { id: "B", name: "Bravo", lat: 41.0, lng: -73.5 },
    { id: "C", name: "Charlie", lat: 30.0, lng: -80.0 },
  ];

  it("returns the closest station within range", () => {
    const r = findNearestStation(stations, 40.7, -74.0);
    expect(r?.station.id).toBe("A");
    expect(r?.distanceKm).toBeLessThan(50);
  });

  it("returns null when no station is within maxKm", () => {
    const r = findNearestStation(stations, 0, 0, 100);
    expect(r).toBeNull();
  });
});

describe("parseNoaaPredictions", () => {
  it("maps signed Velocity_Major to flood/ebb directions", () => {
    const date = new Date(Date.UTC(2026, 4, 25));
    const raw = {
      current_predictions: {
        cp: [
          { Time: "2026-05-25 00:00", Velocity_Major: 0.9, meanFloodDir: 50, meanEbbDir: 230 },
          { Time: "2026-05-25 01:00", Velocity_Major: -1.1, meanFloodDir: 50, meanEbbDir: 230 },
          { Time: "2026-05-25 02:00", Velocity_Major: "0.4", meanFloodDir: "50", meanEbbDir: "230" },
        ],
      },
    };
    const hrs = parseNoaaPredictions(raw, date);
    expect(hrs).not.toBeNull();
    expect(hrs).toHaveLength(24);
    expect(hrs![0]).toEqual({ tidalSpeedKnots: 0.9, tidalDegrees: 50 });
    expect(hrs![1]).toEqual({ tidalSpeedKnots: 1.1, tidalDegrees: 230 });
    expect(hrs![2]).toEqual({ tidalSpeedKnots: 0.4, tidalDegrees: 50 });
    // Gaps fill with the last known value
    expect(hrs![23]).toEqual(hrs![2]);
  });

  it("returns null when there are no rows", () => {
    const date = new Date(Date.UTC(2026, 4, 25));
    expect(parseNoaaPredictions({ current_predictions: { cp: [] } }, date)).toBeNull();
    expect(parseNoaaPredictions({}, date)).toBeNull();
  });

  it("skips rows from a different UTC date", () => {
    const date = new Date(Date.UTC(2026, 4, 25));
    const raw = {
      current_predictions: {
        cp: [{ Time: "2026-05-24 12:00", Velocity_Major: 1.0, meanFloodDir: 10, meanEbbDir: 190 }],
      },
    };
    expect(parseNoaaPredictions(raw, date)).toBeNull();
  });
});

describe("GET /surface-conditions — integration with mocked NOAA + Open-Meteo", () => {
  const fetchMock = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    _resetNoaaStationCacheForTests();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses NOAA tidal data when a station is within range", async () => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const cp = Array.from({ length: 24 }, (_, h) => ({
      Time: `${yyyy}-${mm}-${dd} ${String(h).padStart(2, "0")}:00`,
      Velocity_Major: h % 2 === 0 ? 0.8 : -0.7,
      meanFloodDir: 45,
      meanEbbDir: 225,
    }));

    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith(NOAA_STATIONS_URL)) {
        return Promise.resolve(
          jsonResponse({
            stations: [
              { id: "ST001", name: "Test Station", lat: 40.71, lng: -74.01 },
              { id: "ST002", name: "Far Station", lat: 0, lng: 0 },
            ],
          }),
        );
      }
      if (url.startsWith(NOAA_PREDICTIONS_HOST)) {
        expect(url).toContain("station=ST001");
        return Promise.resolve(jsonResponse({ current_predictions: { cp } }));
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return Promise.resolve(
          jsonResponse({
            hourly: {
              wind_speed_10m: Array.from({ length: 24 }, () => 10),
              wind_direction_10m: Array.from({ length: 24 }, () => 180),
            },
          }),
        );
      }
      if (url.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(
          jsonResponse({ hourly: { wave_height: Array.from({ length: 24 }, () => 0.5) } }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const res = await request(makeApp()).get("/surface-conditions?lat=40.7&lon=-74.0");
    expect(res.status).toBe(200);
    expect(res.body.tidalDataSource).toBe("noaa-coops");
    expect(res.body.tidalStationId).toBe("ST001");
    expect(res.body.tidalStationName).toBe("Test Station");
    expect(typeof res.body.tidalStationDistanceKm).toBe("number");
    expect(res.body.estimatedConditions).toBe(false);
    expect(res.body.hours).toHaveLength(24);
    expect(res.body.hours[0].tidalSpeedKnots).toBe(0.8);
    expect(res.body.hours[0].tidalDegrees).toBe(45);
    expect(res.body.hours[1].tidalSpeedKnots).toBe(0.7);
    expect(res.body.hours[1].tidalDegrees).toBe(225);
  });

  it("falls back to sinusoidal when no NOAA station is in range", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith(NOAA_STATIONS_URL)) {
        return Promise.resolve(
          jsonResponse({ stations: [{ id: "ST999", name: "Far", lat: 0, lng: 0 }] }),
        );
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return Promise.resolve(
          jsonResponse({
            hourly: {
              wind_speed_10m: Array.from({ length: 24 }, () => 12),
              wind_direction_10m: Array.from({ length: 24 }, () => 200),
            },
          }),
        );
      }
      if (url.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(
          jsonResponse({ hourly: { wave_height: Array.from({ length: 24 }, () => 0.4) } }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const res = await request(makeApp()).get("/surface-conditions?lat=40.7&lon=-74.0");
    expect(res.status).toBe(200);
    expect(res.body.tidalDataSource).toBe("sinusoidal");
    expect(res.body.tidalStationId).toBeUndefined();
    expect(res.body.hours).toHaveLength(24);
  });

  it("falls back to sinusoidal when the NOAA stations fetch fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith(NOAA_STATIONS_URL)) {
        return Promise.resolve(jsonResponse({}, false, 503));
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return Promise.resolve(
          jsonResponse({
            hourly: {
              wind_speed_10m: Array.from({ length: 24 }, () => 9),
              wind_direction_10m: Array.from({ length: 24 }, () => 90),
            },
          }),
        );
      }
      if (url.includes("marine-api.open-meteo.com")) {
        return Promise.resolve(
          jsonResponse({ hourly: { wave_height: Array.from({ length: 24 }, () => 0.2) } }),
        );
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const res = await request(makeApp()).get("/surface-conditions?lat=40.7&lon=-74.0");
    expect(res.status).toBe(200);
    expect(res.body.tidalDataSource).toBe("sinusoidal");
  });

  it("rejects invalid coordinates", async () => {
    const res = await request(makeApp()).get("/surface-conditions?lat=abc&lon=xyz");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});
