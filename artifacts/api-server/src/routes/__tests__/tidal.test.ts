import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import tidalRouter from "../tidal";

function makeApp() {
  const app = express();
  app.use(tidalRouter);
  return app;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("GET /tidal/schedule", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects missing/invalid coordinates", async () => {
    const res = await request(makeApp()).get("/tidal/schedule");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/i);
  });

  it("rejects an unparseable start parameter", async () => {
    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=55.5&lon=-132.5&start=not-a-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/start/i);
  });

  it("returns estimated schedule when no NOAA station is in range", async () => {
    // Station list lookup fails → falls back to synthetic events.
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=0&lon=0&days=2&start=2026-05-25T00:00:00Z",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
    expect(res.body.stationId).toBeUndefined();
    expect(res.body.stationName).toMatch(/Estimated/);
    expect(res.body.rangeStart).toBe("2026-05-25T00:00:00.000Z");
    expect(res.body.rangeEnd).toBe("2026-05-27T00:00:00.000Z");
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThan(0);
    for (const e of res.body.events) {
      expect(["high", "low"]).toContain(e.type);
      expect(typeof e.time).toBe("string");
      expect(typeof e.height).toBe("number");
      expect(typeof e.nextDirectionDeg).toBe("number");
      expect(new Date(e.windowStart).getTime()).toBeLessThan(
        new Date(e.windowEnd).getTime(),
      );
    }
  });

  it("clamps days to the supported [1, 14] window", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=10&lon=20&days=999&start=2026-05-25T00:00:00Z",
    );
    expect(res.status).toBe(200);
    const start = new Date(res.body.rangeStart).getTime();
    const end = new Date(res.body.rangeEnd).getTime();
    expect(end - start).toBe(14 * 24 * 3600 * 1000);
  });
});
