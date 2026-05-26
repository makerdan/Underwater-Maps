import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import temperatureProfileRouter, {
  profileProviders,
  type TemperatureProfileProvider,
} from "../temperature-profile";

function makeApp() {
  const app = express();
  app.use(temperatureProfileRouter);
  return app;
}

describe("GET /temperature-profile", () => {
  const originalProviders = profileProviders.slice();

  beforeEach(() => {
    profileProviders.length = 0;
  });
  afterEach(() => {
    profileProviders.length = 0;
    profileProviders.push(...originalProviders);
  });

  it("rejects invalid coordinates", async () => {
    const res = await request(makeApp()).get("/temperature-profile?lat=200&lon=0");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("returns available=false with empty samples when no provider has data", async () => {
    const provider: TemperatureProfileProvider = () => null;
    profileProviders.push(provider);
    const res = await request(makeApp()).get("/temperature-profile?lat=10&lon=20");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.samples).toEqual([]);
    expect(res.body.provider).toBe("none");
  });

  it("returns the payload from the first matching provider", async () => {
    profileProviders.push(() => null);
    profileProviders.push(() => ({
      samples: [
        { depthM: 0, temperatureC: 12.5 },
        { depthM: 100, temperatureC: 6.1 },
      ],
      source: "Bundled CTD cast (Thorne Bay)",
      sourceUrl: "https://example.org/ctd/1",
      timestamp: "2026-04-12T18:00:00.000Z",
      provider: "bundled-ctd",
    }));

    const res = await request(makeApp()).get("/temperature-profile?lat=55.7&lon=-132.5");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.samples).toEqual([
      { depthM: 0, temperatureC: 12.5 },
      { depthM: 100, temperatureC: 6.1 },
    ]);
    expect(res.body.source).toMatch(/Thorne Bay/);
    expect(res.body.provider).toBe("bundled-ctd");
  });

  it("sorts samples shallow→deep even when the provider returns them out of order", async () => {
    profileProviders.push(() => ({
      samples: [
        { depthM: 100, temperatureC: 5 },
        { depthM: 0, temperatureC: 12 },
        { depthM: 50, temperatureC: 8 },
      ],
      source: "test",
      sourceUrl: null,
      timestamp: null,
      provider: "test",
    }));
    const res = await request(makeApp()).get("/temperature-profile?lat=0&lon=0");
    expect(res.body.samples.map((s: { depthM: number }) => s.depthM)).toEqual([0, 50, 100]);
  });

  it("skips a provider that throws and tries the next one", async () => {
    profileProviders.push(() => {
      throw new Error("kaboom");
    });
    profileProviders.push(() => ({
      samples: [
        { depthM: 0, temperatureC: 11 },
        { depthM: 200, temperatureC: 5 },
      ],
      source: "fallback provider",
      sourceUrl: null,
      timestamp: null,
      provider: "test",
    }));
    const res = await request(makeApp()).get("/temperature-profile?lat=0&lon=0");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("fallback provider");
  });

  it("treats a single-sample provider as no data (cannot plot a line)", async () => {
    profileProviders.push(() => ({
      samples: [{ depthM: 0, temperatureC: 10 }],
      source: "just one point",
      sourceUrl: null,
      timestamp: null,
      provider: "test",
    }));
    const res = await request(makeApp()).get("/temperature-profile?lat=0&lon=0");
    expect(res.body.available).toBe(false);
    expect(res.body.samples).toEqual([]);
  });

  it("forwards datasetId to providers so they can pick a preset-bundled cast", async () => {
    const seen: Array<{ lat: number; lon: number; datasetId: string | null }> = [];
    profileProviders.push((req) => {
      seen.push({ lat: req.lat, lon: req.lon, datasetId: req.datasetId ?? null });
      return null;
    });
    await request(makeApp()).get("/temperature-profile?lat=55.7&lon=-132.5&datasetId=thorne-bay");
    expect(seen).toEqual([{ lat: 55.7, lon: -132.5, datasetId: "thorne-bay" }]);
  });
});
