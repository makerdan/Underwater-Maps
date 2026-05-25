import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import tidalRouter, {
  __clearHighLowEventsCacheForTests,
  __clearCurrentsPeakCacheForTests,
  __clearStationCachesForTests,
} from "../tidal";

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
    __clearHighLowEventsCacheForTests();
    __clearCurrentsPeakCacheForTests();
    __clearStationCachesForTests();
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

describe("GET /tidal", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __clearHighLowEventsCacheForTests();
    __clearCurrentsPeakCacheForTests();
    __clearStationCachesForTests();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects missing/invalid coordinates", async () => {
    const res = await request(makeApp()).get("/tidal");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat and lon/i);
  });

  it("rejects an unparseable datetime parameter", async () => {
    const res = await request(makeApp()).get(
      "/tidal?lat=55.5&lon=-132.5&datetime=not-a-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/datetime/i);
  });

  it("returns an estimated payload when no NOAA stations are in range (legacy fields populated, no crash)", async () => {
    // Station list lookup returns no stations → both heights and currents
    // fall back to estimates. This exercises the branch that previously
    // crashed with `ReferenceError: getNearestStation is not defined`.
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal?lat=0&lon=0&datetime=2026-05-25T00:00:00Z",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
    expect(res.body.heightsSource).toBe("estimated");
    expect(res.body.currentsSource).toBe("estimated");
    expect(res.body.stationName).toMatch(/Estimated/);
    expect(res.body.stationId).toBeUndefined();
    expect(res.body.heightsStation).toBeUndefined();
    expect(res.body.currentsStation).toBeUndefined();
    expect(typeof res.body.tideHeight).toBe("number");
    expect(typeof res.body.currentDirection).toBe("number");
    expect(typeof res.body.currentSpeed).toBe("number");
    expect(res.body.isPredicted).toBe(true);
    expect(res.body.slack).toBeDefined();
  });

  it("recovers from a transient empty NOAA station list via the admin refresh endpoint", async () => {
    const station = {
      id: "9450460",
      name: "Ketchikan",
      lat: 55.33,
      lng: -131.63,
    };
    process.env["TIDAL_ADMIN_TOKEN"] = "test-token";

    try {
      // First request: NOAA returns empty station lists for both networks
      // (simulating a transient outage / partial response).
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ stations: [] }))
        .mockResolvedValueOnce(jsonResponse({ stations: [] }));

      const app = makeApp();
      const first = await request(app).get(
        `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-25T03:00:00Z`,
      );
      expect(first.status).toBe(200);
      expect(first.body.source).toBe("estimated");
      expect(first.body.heightsStation).toBeUndefined();

      // Admin endpoint requires the configured token.
      const unauth = await request(app).post("/tidal/admin/refresh-stations");
      expect(unauth.status).toBe(401);

      // With the right token it clears the cache and reports what it cleared.
      const refresh = await request(app)
        .post("/tidal/admin/refresh-stations")
        .set("x-admin-token", "test-token");
      expect(refresh.status).toBe(200);
      expect(refresh.body.ok).toBe(true);
      expect(refresh.body.cleared).toBe(2);

      // Subsequent request re-hits NOAA, which is now healthy, and we get
      // the real station instead of being pinned to "estimated" all day.
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({ stations: [station] }))
        .mockResolvedValueOnce(jsonResponse({ stations: [] }))
        .mockResolvedValueOnce(
          jsonResponse({
            predictions: [
              { t: "2026-05-25 00:00", v: "2.0", type: "H" },
              { t: "2026-05-25 06:00", v: "0.2", type: "L" },
              { t: "2026-05-25 12:00", v: "2.1", type: "H" },
              { t: "2026-05-25 18:00", v: "0.1", type: "L" },
            ],
          }),
        )
        .mockResolvedValue(jsonResponse({ current_predictions: { cp: [] } }));

      const second = await request(app).get(
        `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-25T03:00:00Z`,
      );
      expect(second.status).toBe(200);
      expect(second.body.heightsSource).toBe("noaa");
      expect(second.body.heightsStation).toEqual({ id: station.id, name: station.name });
    } finally {
      delete process.env["TIDAL_ADMIN_TOKEN"];
    }
  });

  it("returns 503 from the admin refresh endpoint when TIDAL_ADMIN_TOKEN is unset", async () => {
    delete process.env["TIDAL_ADMIN_TOKEN"];
    const res = await request(makeApp())
      .post("/tidal/admin/refresh-stations")
      .set("x-admin-token", "anything");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/TIDAL_ADMIN_TOKEN/);
  });

  it("populates legacy stationName/stationId from the NOAA heights station when available", async () => {
    const station = {
      id: "9450460",
      name: "Ketchikan",
      lat: 55.33,
      lng: -131.63,
    };
    // 1st call: heights station list. 2nd call: currents station list (empty).
    // 3rd call: heights hi/lo predictions. 4th call: currents predictions (none).
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ stations: [station] }))
      .mockResolvedValueOnce(jsonResponse({ stations: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          predictions: [
            { t: "2026-05-25 00:00", v: "2.0", type: "H" },
            { t: "2026-05-25 06:00", v: "0.2", type: "L" },
            { t: "2026-05-25 12:00", v: "2.1", type: "H" },
            { t: "2026-05-25 18:00", v: "0.1", type: "L" },
          ],
        }),
      )
      .mockResolvedValue(jsonResponse({ current_predictions: { cp: [] } }));

    const res = await request(makeApp()).get(
      `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-25T03:00:00Z`,
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("noaa");
    expect(res.body.heightsSource).toBe("noaa");
    expect(res.body.stationName).toBe(station.name);
    expect(res.body.stationId).toBe(station.id);
    expect(res.body.heightsStation).toEqual({ id: station.id, name: station.name });
  });
});
