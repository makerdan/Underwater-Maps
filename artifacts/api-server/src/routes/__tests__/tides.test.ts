import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import tidesRouter from "../tides";
import { __clearStationListCachesForTests } from "../tidal";
import { __clearTidesPredictionsCacheForTests } from "../../domains/environmental/providers/noaaTides";

function makeApp() {
  const app = express();
  app.use(tidesRouter);
  return app;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const STATIONS_BODY = {
  stations: [
    // Ketchikan-ish
    { id: "9450460", name: "Ketchikan", lat: 55.3319, lng: -131.6261 },
    // Juneau-ish (much farther from the query point below)
    { id: "9452210", name: "Juneau", lat: 58.2988, lng: -134.4124 },
    // Seattle (very far)
    { id: "9447130", name: "Seattle", lat: 47.6026, lng: -122.3393 },
  ],
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.spyOn>;
  __clearStationListCachesForTests();
  __clearTidesPredictionsCacheForTests();
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe("GET /tides/station", () => {
  it("400s on missing coordinates", async () => {
    const res = await request(makeApp()).get("/tides/station");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns the nearest station", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(STATIONS_BODY));
    const res = await request(makeApp()).get("/tides/station?lat=55.34&lon=-131.64");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.station.id).toBe("9450460");
    expect(typeof res.body.station.distanceMiles).toBe("number");
  });

  it("returns available:false when the catalogue is unreachable", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const res = await request(makeApp()).get("/tides/station?lat=55&lon=-131");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
  });
});

describe("GET /tides/:stationId", () => {
  it("400s on a malformed station id", async () => {
    const res = await request(makeApp()).get("/tides/abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns the prediction window for a valid station", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({
      predictions: [
        { t: "2026-07-18 00:00", v: "0" },
        { t: "2026-07-18 06:00", v: "0.5" },
        { t: "2026-07-18 12:00", v: "1" },
      ],
    }));
    const res = await request(makeApp()).get("/tides/9450460");
    expect(res.status).toBe(200);
    expect(res.body.stationId).toBe("9450460");
    expect(res.body.datum).toBe("MLLW");
    expect(res.body.units).toBe("feet");
    expect(res.body.predictions).toHaveLength(3);
  });

  it("502s when NOAA is unavailable", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const res = await request(makeApp()).get("/tides/9450460");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("noaa_unavailable");
  });
});
