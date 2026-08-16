/**
 * env-pack.test.ts — Integration tests for GET /api/env-pack.
 *
 * All external data fetchers are mocked so the tests run offline and quickly.
 * Pattern follows routes/__tests__/water-temperature.test.ts and
 * weather-stations.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock all upstream data-fetcher modules ────────────────────────────────────

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/envPackTidal", () => ({
  fetchTideStationsInRadius: vi.fn(),
}));

vi.mock("../../lib/envPackWeather", () => ({
  fetchWeatherStationPacks: vi.fn(),
}));

vi.mock("../../lib/envPackMarine", () => ({
  fetchMarineConditions: vi.fn(),
}));

vi.mock("../../lib/argoErddap", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/argoErddap")>();
  return { ...original, fetchArgoProfile: vi.fn() };
});

vi.mock("../../lib/temperatureProfiles", () => ({
  findBundledTemperatureProfile: vi.fn(),
}));

// Import mocked functions after vi.mock declarations.
import { fetchTideStationsInRadius } from "../../lib/envPackTidal";
import { fetchWeatherStationPacks } from "../../lib/envPackWeather";
import { fetchMarineConditions } from "../../lib/envPackMarine";
import { fetchArgoProfile } from "../../lib/argoErddap";
import { findBundledTemperatureProfile } from "../../lib/temperatureProfiles";
import { logger } from "../../lib/logger";

const tidalMock = fetchTideStationsInRadius as ReturnType<typeof vi.fn>;
const weatherMock = fetchWeatherStationPacks as ReturnType<typeof vi.fn>;
const marineMock = fetchMarineConditions as ReturnType<typeof vi.fn>;
const argoMock = fetchArgoProfile as ReturnType<typeof vi.fn>;
const bundledMock = findBundledTemperatureProfile as ReturnType<typeof vi.fn>;
const loggerWarnMock = logger.warn as ReturnType<typeof vi.fn>;

// Import the route AFTER mocks are set up.
import envPackRouter, { __clearEnvPackCacheForTests } from "../env-pack";

function makeApp() {
  const app = express();
  app.use(envPackRouter);
  return app;
}

// ── Sample fixture data ───────────────────────────────────────────────────────

const SAMPLE_TIDE_STATIONS = [
  {
    stationId: "9414290",
    name: "San Francisco",
    lat: 37.8067,
    lon: -122.465,
    distanceMiles: 5.2,
    windowStart: "2026-08-14T00:00:00.000Z",
    windowEnd: "2026-08-28T00:00:00.000Z",
    datum: "MLLW" as const,
    units: "feet" as const,
    predictions: [{ t: "2026-08-14T00:00:00.000Z", v: 3.5 }],
    datums: { stationId: "9414290", mhwFt: 5.5, mhhwFt: 5.8, datum: "MLLW" as const, units: "feet" as const },
  },
];

const SAMPLE_WEATHER_STATIONS = [
  {
    id: "KSFO",
    name: "San Francisco Intl",
    lat: 37.619,
    lon: -122.375,
    windSpeedKnots: 12.5,
    windDirDeg: 270,
    visibilityMiles: 10,
    ceilingFt: null,
    tempC: 15.0,
    observedAt: "2026-08-14T10:00:00Z",
    hourlyForecast: [
      {
        startTime: "2026-08-14T11:00:00-07:00",
        endTime: "2026-08-14T12:00:00-07:00",
        temperature: 68,
        temperatureUnit: "F",
        windSpeed: "15 mph",
        windDirection: "W",
        shortForecast: "Mostly Sunny",
        isDaytime: true,
      },
    ],
  },
];

const SAMPLE_MARINE_CONDITIONS = {
  times: ["2026-08-14T00:00:00.000Z", "2026-08-14T01:00:00.000Z"],
  seaSurfaceTemperatureC: [15.5, 15.6],
  waveHeightM: [1.2, 1.1],
  waveDirectionDeg: [270.0, 268.0],
};

const SAMPLE_ARGO_PROFILE = {
  samples: [
    { depthM: 0, temperatureC: 15.5 },
    { depthM: 50, temperatureC: 12.0 },
    { depthM: 100, temperatureC: 8.5 },
  ],
  source: "Argo float 1234 cycle 5",
  sourceUrl: "https://example.com",
  timestamp: "2026-08-01T00:00:00Z",
  provider: "argo",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /env-pack — parameter validation", () => {
  beforeEach(() => {
    __clearEnvPackCacheForTests();
    tidalMock.mockReset();
    weatherMock.mockReset();
    marineMock.mockReset();
    argoMock.mockReset();
    bundledMock.mockReset();
  });

  it("returns 400 when lat and lon are missing", async () => {
    const res = await request(makeApp()).get("/env-pack");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when lat is out of range", async () => {
    const res = await request(makeApp()).get("/env-pack?lat=91&lon=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when lon is out of range", async () => {
    const res = await request(makeApp()).get("/env-pack?lat=37&lon=200");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when days exceeds 14", async () => {
    const res = await request(makeApp()).get("/env-pack?lat=37&lon=-122&days=15");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when radiusMiles exceeds 200", async () => {
    const res = await request(makeApp()).get("/env-pack?lat=37&lon=-122&radiusMiles=201");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});

describe("GET /env-pack — happy path (all sources return data)", () => {
  beforeEach(() => {
    __clearEnvPackCacheForTests();
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null); // force Argo path
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);
  });

  it("returns 200 with all four data sections populated", async () => {
    const res = await request(makeApp()).get(
      "/env-pack?lat=37.8&lon=-122.4&radiusMiles=15&days=14",
    );

    expect(res.status).toBe(200);
    expect(res.body.centerLat).toBe(37.8);
    expect(res.body.centerLon).toBe(-122.4);
    expect(res.body.coverageRadiusMiles).toBe(15);
    expect(typeof res.body.generatedAt).toBe("string");
    expect(typeof res.body.expiresAt).toBe("string");

    // Tide stations
    expect(Array.isArray(res.body.tideStations)).toBe(true);
    expect(res.body.tideStations).toHaveLength(1);
    expect(res.body.tideStations[0].stationId).toBe("9414290");
    expect(res.body.tideStations[0].datums.mhwFt).toBe(5.5);

    // Weather stations
    expect(Array.isArray(res.body.weatherStations)).toBe(true);
    expect(res.body.weatherStations).toHaveLength(1);
    expect(res.body.weatherStations[0].id).toBe("KSFO");
    expect(Array.isArray(res.body.weatherStations[0].hourlyForecast)).toBe(true);

    // Marine conditions
    expect(res.body.marineConditions).not.toBeNull();
    expect(Array.isArray(res.body.marineConditions.times)).toBe(true);
    expect(Array.isArray(res.body.marineConditions.seaSurfaceTemperatureC)).toBe(true);

    // Temperature profile
    expect(res.body.temperatureProfile).not.toBeNull();
    expect(res.body.temperatureProfile.available).toBe(true);
    expect(res.body.temperatureProfile.samples).toHaveLength(3);

    // No warnings when everything succeeds
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings).toHaveLength(0);
  });

  it("applies default radiusMiles=15 when omitted", async () => {
    await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");
    expect(tidalMock).toHaveBeenCalledWith(37.8, -122.4, 15, 14);
    expect(weatherMock).toHaveBeenCalledWith(37.8, -122.4, 15);
  });

  it("applies default days=14 when omitted", async () => {
    await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");
    expect(tidalMock).toHaveBeenCalledWith(37.8, -122.4, 15, 14);
    expect(marineMock).toHaveBeenCalledWith(37.8, -122.4, 14);
  });

  it("passes custom radiusMiles and days to fetchers", async () => {
    await request(makeApp()).get(
      "/env-pack?lat=37.8&lon=-122.4&radiusMiles=30&days=7",
    );
    expect(tidalMock).toHaveBeenCalledWith(37.8, -122.4, 30, 7);
    expect(weatherMock).toHaveBeenCalledWith(37.8, -122.4, 30);
    expect(marineMock).toHaveBeenCalledWith(37.8, -122.4, 7);
  });

  it("expiresAt is 14 days after generatedAt", async () => {
    const res = await request(makeApp()).get(
      "/env-pack?lat=37.8&lon=-122.4",
    );
    const generated = new Date(res.body.generatedAt).getTime();
    const expires = new Date(res.body.expiresAt).getTime();
    const diffDays = (expires - generated) / (24 * 3600 * 1000);
    expect(diffDays).toBeCloseTo(14, 0);
  });
});

describe("GET /env-pack — partial failure graceful degradation", () => {
  beforeEach(() => {
    __clearEnvPackCacheForTests();
    tidalMock.mockReset();
    weatherMock.mockReset();
    marineMock.mockReset();
    argoMock.mockReset();
    bundledMock.mockReset();
  });

  it("returns 200 with tideStations=null and a warning when tidal fetch fails", async () => {
    tidalMock.mockRejectedValue(new Error("NOAA catalogue unreachable"));
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    expect(res.body.tideStations).toBeNull();
    expect(res.body.weatherStations).not.toBeNull();
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.warnings.some((w: string) => w.toLowerCase().includes("tide"))).toBe(true);
  });

  it("returns 200 with weatherStations=null and a warning when weather fetch fails", async () => {
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockRejectedValue(new Error("NOAA unavailable"));
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    expect(res.body.weatherStations).toBeNull();
    expect(res.body.tideStations).not.toBeNull();
    expect(res.body.warnings.some((w: string) => w.toLowerCase().includes("weather"))).toBe(true);
  });

  it("returns 200 with marineConditions=null and a warning when marine fetch fails", async () => {
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockRejectedValue(new Error("Open-Meteo timeout"));
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    expect(res.body.marineConditions).toBeNull();
    expect(res.body.warnings.some((w: string) => w.toLowerCase().includes("marine"))).toBe(true);
  });

  it("returns 200 with temperatureProfile.available=false when no profile source works", async () => {
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(null); // no Argo float in range

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    expect(res.body.temperatureProfile.available).toBe(false);
    expect(res.body.warnings.some((w: string) => w.toLowerCase().includes("temperature"))).toBe(true);
  });

  it("returns a structured 503 when every source fails", async () => {
    tidalMock.mockRejectedValue(new Error("tidal down"));
    weatherMock.mockRejectedValue(new Error("weather down"));
    marineMock.mockRejectedValue(new Error("marine down"));
    bundledMock.mockReturnValue(null);
    argoMock.mockRejectedValue(new Error("argo down"));

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("no_data_available");
    expect(Array.isArray(res.body.warnings)).toBe(true);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect(res.body.warnings.some((w: string) => w.includes("tidal down"))).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes("weather down"))).toBe(true);
  });

  it("returns 503 when every fetcher resolves but with no usable data", async () => {
    tidalMock.mockResolvedValue(null); // null = station catalogue unavailable
    weatherMock.mockResolvedValue([]);
    marineMock.mockResolvedValue(null);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(null);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    // All four sources empty (empty arrays / unavailable profile count as
    // no-data) → structured 503, not a 200 full of nulls.
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("no_data_available");
    expect(Array.isArray(res.body.warnings)).toBe(true);
  });

  it("formats non-Error rejection reasons as readable warning strings", async () => {
    tidalMock.mockRejectedValue("catalogue exploded"); // string, not Error
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    const tideWarning = res.body.warnings.find((w: string) =>
      w.toLowerCase().includes("tide"),
    );
    expect(tideWarning).toContain("catalogue exploded");
    expect(tideWarning).not.toContain("unknown error");
    expect(tideWarning).not.toContain("undefined");
  });

  it("does not cache the 503 complete-failure response", async () => {
    const app = makeApp();
    tidalMock.mockRejectedValueOnce(new Error("tidal down"));
    weatherMock.mockRejectedValueOnce(new Error("weather down"));
    marineMock.mockRejectedValueOnce(new Error("marine down"));
    bundledMock.mockReturnValue(null);
    argoMock.mockRejectedValueOnce(new Error("argo down"));

    const first = await request(app).get("/env-pack?lat=37.8&lon=-122.4");
    expect(first.status).toBe(503);

    // Sources recover — the same query must succeed, proving the 503 was
    // never written into the 30-minute pack cache.
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const second = await request(app).get("/env-pack?lat=37.8&lon=-122.4");
    expect(second.status).toBe(200);
    expect(second.body.tideStations).toHaveLength(1);
  });

  it("returns 200 when only marine conditions are available (marine-only pack)", async () => {
    tidalMock.mockResolvedValue(null);
    weatherMock.mockResolvedValue([]);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(null);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    expect(res.body.marineConditions).not.toBeNull();
    expect(res.body.tideStations).toBeNull();
  });

  it("includes an empty warnings array when stations exist but no data sources fail", async () => {
    tidalMock.mockResolvedValue([]);
    weatherMock.mockResolvedValue([]);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    expect(res.status).toBe(200);
    // Empty arrays produce "no stations found" warnings, not fetch errors.
    const hasStationWarnings = res.body.warnings.some(
      (w: string) => w.includes("No NOAA"),
    );
    expect(hasStationWarnings).toBe(true);
  });

  it("logs a warn for each temperature provider that throws, without leaking error details to the client", async () => {
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);

    const woaError = new Error("WOA endpoint unavailable");
    const argoError = new Error("Argo ERDDAP timeout");
    bundledMock.mockRejectedValue(woaError);
    argoMock.mockRejectedValue(argoError);

    loggerWarnMock.mockClear();

    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");

    // Client response must not expose upstream error details.
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("WOA endpoint unavailable");
    expect(JSON.stringify(res.body)).not.toContain("Argo ERDDAP timeout");

    // logger.warn must have been called once per failing provider.
    expect(loggerWarnMock).toHaveBeenCalledTimes(2);

    const warnCalls = loggerWarnMock.mock.calls;

    const woaCall = warnCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.provider === "woa",
    );
    expect(woaCall).toBeDefined();
    expect(woaCall![0]).toMatch(/temperature profile provider failed/i);
    expect(woaCall![1]).toMatchObject({ provider: "woa", err: woaError });

    const argoCall = warnCalls.find(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.provider === "argo",
    );
    expect(argoCall).toBeDefined();
    expect(argoCall![0]).toMatch(/temperature profile provider failed/i);
    expect(argoCall![1]).toMatchObject({ provider: "argo", err: argoError });
  });
});

describe("GET /env-pack — response caching", () => {
  beforeEach(() => {
    __clearEnvPackCacheForTests();
    tidalMock.mockResolvedValue(SAMPLE_TIDE_STATIONS);
    weatherMock.mockResolvedValue(SAMPLE_WEATHER_STATIONS);
    marineMock.mockResolvedValue(SAMPLE_MARINE_CONDITIONS);
    bundledMock.mockReturnValue(null);
    argoMock.mockResolvedValue(SAMPLE_ARGO_PROFILE);
  });

  it("serves a cached response on the second request without calling fetchers again", async () => {
    const app = makeApp();
    await request(app).get("/env-pack?lat=37.8&lon=-122.4");
    tidalMock.mockClear();
    weatherMock.mockClear();

    await request(app).get("/env-pack?lat=37.8&lon=-122.4");

    expect(tidalMock).not.toHaveBeenCalled();
    expect(weatherMock).not.toHaveBeenCalled();
  });

  it("does not serve a cached response for a different lat/lon", async () => {
    const app = makeApp();
    await request(app).get("/env-pack?lat=37.8&lon=-122.4");
    tidalMock.mockClear();

    await request(app).get("/env-pack?lat=40.0&lon=-74.0");

    expect(tidalMock).toHaveBeenCalledTimes(1);
  });

  it("includes Cache-Control: public, max-age=1800 header", async () => {
    const res = await request(makeApp()).get("/env-pack?lat=37.8&lon=-122.4");
    expect(res.headers["cache-control"]).toContain("max-age=1800");
  });
});
