import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import weatherStationsRouter from "../weather-stations";
import { NoaaUnavailableError } from "../../lib/noaaWeatherFetcher";

vi.mock("../../lib/noaaWeatherFetcher", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/noaaWeatherFetcher")>();
  return {
    ...original,
    fetchWeatherStations: vi.fn(),
  };
});

import { fetchWeatherStations } from "../../lib/noaaWeatherFetcher";

const fetchWeatherStationsMock = fetchWeatherStations as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use(weatherStationsRouter);
  return app;
}

describe("GET /weather-stations — parameter validation", () => {
  it("returns 400 when lat and lon are missing", async () => {
    const res = await request(makeApp()).get("/weather-stations");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when lat is out of range", async () => {
    const res = await request(makeApp()).get("/weather-stations?lat=91&lon=-74");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when lon is out of range", async () => {
    const res = await request(makeApp()).get("/weather-stations?lat=40&lon=181");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when radiusMiles is 0", async () => {
    const res = await request(makeApp()).get("/weather-stations?lat=40&lon=-74&radiusMiles=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when radiusMiles exceeds 500", async () => {
    const res = await request(makeApp()).get("/weather-stations?lat=40&lon=-74&radiusMiles=501");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});

describe("GET /weather-stations — NOAA down, no cached data", () => {
  beforeEach(() => {
    fetchWeatherStationsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 with error=noaa_unavailable when NoaaUnavailableError is thrown", async () => {
    fetchWeatherStationsMock.mockRejectedValue(
      new NoaaUnavailableError(
        "NOAA weather API is unavailable and there is no cached data for this location",
      ),
    );

    const res = await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("noaa_unavailable");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it("503 body does not include a 'details' field (uses 'message' instead)", async () => {
    fetchWeatherStationsMock.mockRejectedValue(
      new NoaaUnavailableError("NOAA unavailable"),
    );

    const res = await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(res.status).toBe(503);
    expect(res.body.details).toBeUndefined();
    expect(res.body.message).toBeDefined();
  });

  it("still returns 502 for unexpected (non-NOAA) errors", async () => {
    fetchWeatherStationsMock.mockRejectedValue(new Error("unexpected internal error"));

    const res = await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("upstream_error");
  });
});

describe("GET /weather-stations — happy path", () => {
  beforeEach(() => {
    fetchWeatherStationsMock.mockReset();
  });

  it("returns 200 with station data on success", async () => {
    const mockResult = {
      stations: [
        {
          id: "KSEA",
          name: "Seattle-Tacoma Intl Airport",
          lat: 47.4444,
          lon: -122.3139,
          windSpeedKnots: 7.5,
          windDirDeg: 180,
          visibilityMiles: 10,
          ceilingFt: null,
          tempC: 12.3,
          observedAt: "2026-05-31T10:00:00Z",
        },
      ],
      stateCode: "WA",
      faaWeatherCamsUrl: "https://weathercams.faa.gov/cameras/state/WA",
    };

    fetchWeatherStationsMock.mockResolvedValue(mockResult);

    const res = await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stations)).toBe(true);
    expect(res.body.stations).toHaveLength(1);
    expect(res.body.stations[0].id).toBe("KSEA");
    expect(res.body.stateCode).toBe("WA");
    expect(res.body.faaWeatherCamsUrl).toContain("WA");
  });

  it("returns 200 with stale:true when serving DB fallback data", async () => {
    fetchWeatherStationsMock.mockResolvedValue({
      stations: [],
      stateCode: "WA",
      faaWeatherCamsUrl: null,
      stale: true,
    });

    const res = await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
  });

  it("uses default radiusMiles=75 when omitted", async () => {
    fetchWeatherStationsMock.mockResolvedValue({
      stations: [],
      stateCode: null,
      faaWeatherCamsUrl: null,
    });

    await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3");

    expect(fetchWeatherStationsMock).toHaveBeenCalledWith(47.6, -122.3, 75);
  });

  it("passes custom radiusMiles to fetchWeatherStations", async () => {
    fetchWeatherStationsMock.mockResolvedValue({
      stations: [],
      stateCode: null,
      faaWeatherCamsUrl: null,
    });

    await request(makeApp()).get("/weather-stations?lat=47.6&lon=-122.3&radiusMiles=50");

    expect(fetchWeatherStationsMock).toHaveBeenCalledWith(47.6, -122.3, 50);
  });
});
