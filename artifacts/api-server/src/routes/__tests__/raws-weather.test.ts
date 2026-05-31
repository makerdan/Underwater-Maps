import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import rawsWeatherRouter from "../raws-weather";
import { __clearRawsObsCache } from "../../lib/rawsErddap";

function makeApp() {
  const app = express();
  app.use(rawsWeatherRouter);
  return app;
}

function makeInfoResponse(varNames: string[]) {
  return {
    table: {
      columnNames: ["Row Type", "Variable Name"],
      rows: [
        ...varNames.map((name) => ["variable", name]),
        ["attribute", "NC_GLOBAL"],
      ],
    },
  };
}

function makeObsResponse(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    time: "2026-05-31T10:00:00Z",
    air_temperature: 22.5,
    wind_speed: 3.1,
    wind_from_direction: 270,
    wind_speed_of_gust: 5.0,
    relative_humidity: 55.0,
    ...overrides,
  };
  const cols = Object.keys(data);
  const rows = [cols.map((k) => data[k])];
  return { table: { columnNames: cols, rows } };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("GET /raws-weather — parameter validation", () => {
  const app = makeApp();

  it("returns 400 when datasetId is missing", async () => {
    const res = await request(app).get("/raws-weather");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when datasetId does not match the raws_* pattern", async () => {
    const res = await request(app).get("/raws-weather?datasetId=arbitrary_dataset");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 for an empty datasetId string", async () => {
    const res = await request(app).get("/raws-weather?datasetId=");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns 400 when datasetId starts with 'raws' but is missing the underscore", async () => {
    const res = await request(app).get("/raws-weather?datasetId=rawsAnchorage");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });
});

describe("GET /raws-weather — ERDDAP integration with mocked fetch", () => {
  const fetchMock = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    __clearRawsObsCache();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns { available: true, observation } for a valid raws_* datasetId", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/info/raws_test_station/")) {
        return Promise.resolve(
          jsonResponse(
            makeInfoResponse([
              "time",
              "air_temperature",
              "wind_speed",
              "wind_from_direction",
              "relative_humidity",
            ]),
          ),
        );
      }
      if (url.includes("/tabledap/raws_test_station")) {
        return Promise.resolve(jsonResponse(makeObsResponse()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const res = await request(makeApp()).get(
      "/raws-weather?datasetId=raws_test_station",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.station.datasetId).toBe("raws_test_station");
    expect(res.body.observation).toBeDefined();
    expect(res.body.observation.time).toBe("2026-05-31T10:00:00Z");
    expect(typeof res.body.observation.airTemperatureC).toBe("number");
    expect(res.body.observation.airTemperatureC).toBeCloseTo(22.5, 5);
    expect(typeof res.body.observation.windSpeedMs).toBe("number");
    expect(typeof res.body.observation.windFromDirectionDeg).toBe("number");
  });

  it("observation has the full RawsObservation shape", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/info/raws_shape_check/")) {
        return Promise.resolve(
          jsonResponse(
            makeInfoResponse([
              "time",
              "air_temperature",
              "wind_speed",
              "wind_from_direction",
              "wind_speed_of_gust",
              "relative_humidity",
              "solar_irradiance",
              "lwe_thickness_of_precipitation_amount",
              "fuel_temperature",
              "battery_voltage",
            ]),
          ),
        );
      }
      if (url.includes("/tabledap/raws_shape_check")) {
        return Promise.resolve(
          jsonResponse(
            makeObsResponse({
              solar_irradiance: 450,
              lwe_thickness_of_precipitation_amount: 0,
              fuel_temperature: 18.0,
              battery_voltage: 12.4,
            }),
          ),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const res = await request(makeApp()).get(
      "/raws-weather?datasetId=raws_shape_check",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);

    const obs = res.body.observation;
    expect(typeof obs.time).toBe("string");
    expect(typeof obs.airTemperatureC).toBe("number");
    expect(typeof obs.windSpeedMs).toBe("number");
    expect(typeof obs.windFromDirectionDeg).toBe("number");
    expect(typeof obs.windGustMs).toBe("number");
    expect(typeof obs.relativeHumidityPct).toBe("number");
    expect(typeof obs.solarIrradianceWm2).toBe("number");
    expect(typeof obs.precipitationMm).toBe("number");
    expect(typeof obs.fuelTemperatureC).toBe("number");
    expect(typeof obs.batteryVoltageV).toBe("number");
  });

  it("returns { available: false } with HTTP 200 when ERDDAP is unavailable", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/info/raws_unavailable/")) {
        return Promise.resolve(jsonResponse({}, false, 503));
      }
      if (url.includes("/tabledap/raws_unavailable")) {
        return Promise.resolve(jsonResponse({}, false, 503));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const res = await request(makeApp()).get(
      "/raws-weather?datasetId=raws_unavailable",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.observation).toBeUndefined();
  });

  it("returns { available: false } with HTTP 200 when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network timeout"));

    const res = await request(makeApp()).get(
      "/raws-weather?datasetId=raws_network_error",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it("returns { available: false } when ERDDAP returns an empty rows array", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/info/raws_empty/")) {
        return Promise.resolve(
          jsonResponse(makeInfoResponse(["time", "air_temperature"])),
        );
      }
      if (url.includes("/tabledap/raws_empty")) {
        return Promise.resolve(
          jsonResponse({ table: { columnNames: ["time"], rows: [] } }),
        );
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const res = await request(makeApp()).get(
      "/raws-weather?datasetId=raws_empty",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it("serves the second call from cache without a second ERDDAP fetch", async () => {
    const datasetId = "raws_cache_test";
    let erddapFetchCount = 0;

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/info/${datasetId}/`)) {
        erddapFetchCount++;
        return Promise.resolve(
          jsonResponse(makeInfoResponse(["time", "air_temperature", "wind_speed"])),
        );
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        erddapFetchCount++;
        return Promise.resolve(jsonResponse(makeObsResponse()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const app = makeApp();

    const res1 = await request(app).get(`/raws-weather?datasetId=${datasetId}`);
    expect(res1.status).toBe(200);
    expect(res1.body.available).toBe(true);

    const fetchCountAfterFirst = erddapFetchCount;
    expect(fetchCountAfterFirst).toBeGreaterThan(0);

    const res2 = await request(app).get(`/raws-weather?datasetId=${datasetId}`);
    expect(res2.status).toBe(200);
    expect(res2.body.available).toBe(true);

    expect(erddapFetchCount).toBe(fetchCountAfterFirst);
  });

  it("caches a negative (unavailable) result and does not re-fetch within TTL", async () => {
    const datasetId = "raws_neg_cache";
    let fetchCount = 0;

    fetchMock.mockImplementation((url: string) => {
      fetchCount++;
      if (url.includes(`/info/${datasetId}/`)) {
        return Promise.resolve(jsonResponse({}, false, 503));
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        return Promise.resolve(jsonResponse({}, false, 503));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const app = makeApp();

    const res1 = await request(app).get(`/raws-weather?datasetId=${datasetId}`);
    expect(res1.body.available).toBe(false);

    const countAfterFirst = fetchCount;

    const res2 = await request(app).get(`/raws-weather?datasetId=${datasetId}`);
    expect(res2.body.available).toBe(false);

    expect(fetchCount).toBe(countAfterFirst);
  });

  it("accepts datasetId values with hyphens and numbers", async () => {
    const datasetId = "raws_station-42_abc";

    fetchMock.mockImplementation((url: string) => {
      if (url.includes(`/info/${datasetId}/`)) {
        return Promise.resolve(
          jsonResponse(makeInfoResponse(["time", "air_temperature"])),
        );
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        return Promise.resolve(jsonResponse(makeObsResponse()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    const res = await request(makeApp()).get(
      `/raws-weather?datasetId=${datasetId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it("uses the ERDDAP base URL for all fetches", async () => {
    const urls: string[] = [];
    const datasetId = "raws_url_check";

    fetchMock.mockImplementation((url: string) => {
      urls.push(url as string);
      if (url.includes(`/info/${datasetId}/`)) {
        return Promise.resolve(
          jsonResponse(makeInfoResponse(["time", "air_temperature"])),
        );
      }
      if (url.includes(`/tabledap/${datasetId}`)) {
        return Promise.resolve(jsonResponse(makeObsResponse()));
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });

    await request(makeApp()).get(`/raws-weather?datasetId=${datasetId}`);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/erddap\.aoos\.org\/erddap\//);
    }
  });
});
