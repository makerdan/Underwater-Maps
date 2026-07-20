import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import freshwaterUsgsUnavailable from "./fixtures/freshwater-usgs-unavailable.json";
import freshwaterUsgsAvailable from "./fixtures/freshwater-usgs-available.json";
import freshwaterGlerl from "./fixtures/freshwater-glerl.json";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-test-user-id"] ?? null,
  })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import tidalRouter, { __clearHighLowEventsCacheForTests } from "../tidal";

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
    fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects missing/invalid coordinates", async () => {
    const res = await request(makeApp()).get("/tidal/schedule");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(res.body.details).toMatch(/lat and lon/i);
  });

  it("rejects an unparseable start parameter", async () => {
    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=55.5&lon=-132.5&start=not-a-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(res.body.details).toMatch(/start/i);
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

  it("rejects days outside the supported [1, 14] window with 400", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=10&lon=20&days=999&start=2026-05-25T00:00:00Z",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("accepts the maximum supported days=14", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal/schedule?lat=10&lon=20&days=14&start=2026-05-25T00:00:00Z",
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
    fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects missing/invalid coordinates", async () => {
    const res = await request(makeApp()).get("/tidal");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(res.body.details).toMatch(/lat and lon/i);
  });

  it("rejects an unparseable datetime parameter", async () => {
    const res = await request(makeApp()).get(
      "/tidal?lat=55.5&lon=-132.5&datetime=not-a-date",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(res.body.details).toMatch(/datetime/i);
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
    process.env["ADMIN_USER_IDS"] = "user_test_admin";

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

      // Admin endpoint requires authentication — no session → 401.
      const unauth = await request(app).post("/tidal/admin/refresh-stations");
      expect(unauth.status).toBe(401);

      // Authenticated admin user clears the cache and reports what it cleared.
      const refresh = await request(app)
        .post("/tidal/admin/refresh-stations")
        .set("x-test-user-id", "user_test_admin");
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
      delete process.env["ADMIN_USER_IDS"];
    }
  });

  it("negatively caches NOAA station-list failures so one outage doesn't fan out into many upstream fetches", async () => {
    // Every fetch rejects (simulating a NOAA outage with no prior cache).
    fetchSpy.mockRejectedValue(new Error("NOAA down"));

    const app = makeApp();

    const first = await request(app).get(
      "/tidal?lat=55.33&lon=-131.63&datetime=2026-05-25T03:00:00Z",
    );
    expect(first.status).toBe(200);
    expect(first.body.source).toBe("estimated");

    const callsAfterFirst = fetchSpy.mock.calls.length;
    // Both station-list lookups (heights + currents) hit NOAA once each.
    expect(callsAfterFirst).toBe(2);

    // A burst of follow-up requests should NOT re-hit NOAA while the
    // negative-cache window is open — they short-circuit to estimates.
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get(
        "/tidal?lat=55.33&lon=-131.63&datetime=2026-05-25T03:00:00Z",
      );
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("estimated");
    }
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("falls back to the previously cached station list when NOAA later fails", async () => {
    const station = {
      id: "9450460",
      name: "Ketchikan",
      lat: 55.33,
      lng: -131.63,
    };
    // First request: NOAA is healthy and returns a real station list for
    // heights; currents list is empty; hi/lo predictions succeed.
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
      );

    const app = makeApp();
    const warm = await request(app).get(
      `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-25T03:00:00Z`,
    );
    expect(warm.status).toBe(200);
    expect(warm.body.heightsStation).toEqual({ id: station.id, name: station.name });

    // Expire the good cache so getStationList re-fetches, but make the
    // upstream fail — we should still get the previously cached station.
    __clearHighLowEventsCacheForTests();
    // Simulate cache expiry by advancing the clock past the 24h TTL.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000); // > 24h TTL

      fetchSpy.mockReset();
      fetchSpy
        .mockRejectedValueOnce(new Error("NOAA outage")) // heights list refetch
        .mockRejectedValueOnce(new Error("NOAA outage")) // currents list refetch
        .mockResolvedValue(
          jsonResponse({
            predictions: [
              { t: "2026-05-26 00:00", v: "2.0", type: "H" },
              { t: "2026-05-26 06:00", v: "0.2", type: "L" },
            ],
          }),
        );

      const stale = await request(app).get(
        `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-26T03:00:00Z`,
      );
      expect(stale.status).toBe(200);
      // Even though NOAA refused to refresh the station list, the previous
      // good cache is reused so heights still resolves to the real station.
      expect(stale.body.heightsStation).toEqual({ id: station.id, name: station.name });

      // Count how many fetch calls the first stale request consumed
      // (two station-list refetches + at least one prediction call).
      const upstreamCallsAfterStale = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes("/mdapi/prod/webapi/stations.json"),
      ).length;
      expect(upstreamCallsAfterStale).toBe(2);

      // A burst of follow-up requests during the 60s failure window must
      // NOT re-hit the NOAA station-list endpoint — they should serve
      // the stale cache immediately instead of paying another 8s timeout.
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get(
          `/tidal?lat=${station.lat}&lon=${station.lng}&datetime=2026-05-26T03:00:00Z`,
        );
        expect(res.status).toBe(200);
        expect(res.body.heightsStation).toEqual({ id: station.id, name: station.name });
      }
      const stationListCalls = fetchSpy.mock.calls.filter((c) =>
        String(c[0]).includes("/mdapi/prod/webapi/stations.json"),
      ).length;
      expect(stationListCalls).toBe(upstreamCallsAfterStale);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 403 from the admin refresh endpoint when the authenticated user is not an admin", async () => {
    delete process.env["ADMIN_USER_IDS"];
    delete process.env["BUCKET_MONITOR_ADMIN"];
    const res = await request(makeApp())
      .post("/tidal/admin/refresh-stations")
      .set("x-test-user-id", "user_not_admin");
    expect(res.status).toBe(403);
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

describe("POST /tidal/admin/refresh-stations — auth guard", () => {
  it("returns 401 for unauthenticated callers (no session)", async () => {
    const app = express();
    app.use(tidalRouter);
    const res = await request(app).post("/tidal/admin/refresh-stations");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Freshwater regression tests — waterType=freshwater branch
//
// Fixtures live in ./fixtures/freshwater-*.json so that API and frontend tests
// share the same shape definition.  If the shape evolves, update the fixtures
// and every consumer will stay in sync.
// ---------------------------------------------------------------------------

describe("GET /tidal?waterType=freshwater", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
    __clearHighLowEventsCacheForTests();
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns available:false with source:'usgs' when no nearby USGS station is found", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ value: { timeSeries: [] } }));

    const res = await request(makeApp()).get(
      "/tidal?lat=43.55&lon=-89.47&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.source).toBe("usgs");
    // Must NOT fall through to sinusoidal (which sets available:true + tideHeight)
    expect(res.body.tideHeight).toBeUndefined();
    // Shape matches the shared fixture
    expect(res.body).toMatchObject(freshwaterUsgsUnavailable);
  });

  it("returns available:true with source:'usgs' when a USGS gage station is nearby", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        value: {
          timeSeries: [
            {
              sourceInfo: {
                siteName: "Wisconsin River at Portage, WI",
                siteCode: [{ value: "05407000" }],
                geoLocation: {
                  geogLocation: { latitude: 43.5422, longitude: -89.47 },
                },
              },
            },
          ],
        },
      }),
    );

    const res = await request(makeApp()).get(
      "/tidal?lat=43.55&lon=-89.47&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("usgs");
    expect(res.body.heightsSource).toBe("usgs");
    expect(res.body.currentsSource).toBe("usgs");
    expect(res.body.stationId).toBe("05407000");
    expect(res.body.stationName).toBe("Wisconsin River at Portage, WI");
    expect(res.body.isPredicted).toBe(true);
    expect(typeof res.body.tideHeight).toBe("number");
    // Shape matches the shared fixture (subset check)
    expect(res.body).toMatchObject(freshwaterUsgsAvailable);
  });

  it("returns available:true with source:'glerl' for Great Lakes coordinates", async () => {
    // Great Lakes → GLERL bounding-box check fires before any USGS fetch
    const res = await request(makeApp()).get(
      "/tidal?lat=44.0&lon=-86.0&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("glerl");
    expect(res.body.heightsSource).toBe("glerl");
    expect(res.body.currentsSource).toBe("glerl");
    expect(res.body.stationName).toMatch(/GLERL/);
    expect(res.body.isPredicted).toBe(true);
    expect(typeof res.body.tideHeight).toBe("number");
    // No USGS network call should have been made
    expect(fetchSpy.mock.calls.length).toBe(0);
    // Shape matches the shared fixture (subset check)
    expect(res.body).toMatchObject(freshwaterGlerl);
  });

  it("does not return source:'estimated' or source:'noaa' for freshwater (regression guard)", async () => {
    // No USGS station found — but source must still be 'usgs', not 'estimated'
    fetchSpy.mockResolvedValue(jsonResponse({ value: { timeSeries: [] } }));

    const res = await request(makeApp()).get(
      "/tidal?lat=43.55&lon=-89.47&datetime=2026-07-20T12:00:00Z&waterType=freshwater",
    );

    expect(res.status).toBe(200);
    expect(res.body.source).not.toBe("estimated");
    expect(res.body.source).not.toBe("noaa");
  });

  it("Great Lakes path does not silently fall back to sinusoidal when waterType is omitted", async () => {
    // Without waterType=freshwater the saltwater (NOAA) path is taken,
    // so the source will be 'estimated' (no station) — NOT 'glerl'.
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));

    const res = await request(makeApp()).get(
      "/tidal?lat=44.0&lon=-86.0&datetime=2026-07-20T12:00:00Z",
    );

    expect(res.status).toBe(200);
    // Without the freshwater param the route uses NOAA → falls back to estimated
    expect(res.body.source).not.toBe("glerl");
    expect(res.body.source).not.toBe("usgs");
  });

  it("rejects an invalid waterType value with 400", async () => {
    const res = await request(makeApp()).get(
      "/tidal?lat=44.0&lon=-86.0&waterType=brackish",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });
});
