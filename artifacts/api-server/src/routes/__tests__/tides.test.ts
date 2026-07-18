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

import tidesRouter, {
  findNearestTideStation,
  getTidePredictions,
  TIDES_PREDICTIONS_TTL_MS,
  TIDES_WINDOW_DAYS,
  __clearTidesPredictionsCacheForTests,
  __tidesPredictionsCacheSizeForTests,
} from "../tides";
import { __clearStationListCachesForTests } from "../tidal";

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

function predictionsBody(count = 3) {
  const preds: Array<{ t: string; v: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, 6, 18, 0, i * 6));
    const pad = (n: number) => String(n).padStart(2, "0");
    preds.push({
      t: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
      v: (i * 0.5).toFixed(3),
    });
  }
  return { predictions: preds };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  __clearStationListCachesForTests();
  __clearTidesPredictionsCacheForTests();
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe("findNearestTideStation distance sort", () => {
  it("returns the closest station with distance in statute miles", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(STATIONS_BODY));
    // Query point near Ketchikan.
    const s = await findNearestTideStation(55.34, -131.64);
    expect(s).not.toBeNull();
    expect(s!.id).toBe("9450460");
    expect(s!.name).toBe("Ketchikan");
    // ~1 km away → well under 2 miles.
    expect(s!.distanceMiles).toBeGreaterThanOrEqual(0);
    expect(s!.distanceMiles).toBeLessThan(2);
  });

  it("applies no distance cutoff — far stations still resolve", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(STATIONS_BODY));
    // Mid-Pacific point: nearest is still returned, hundreds of miles away.
    const s = await findNearestTideStation(40, -150);
    expect(s).not.toBeNull();
    expect(s!.distanceMiles).toBeGreaterThan(30);
  });

  it("returns null when the station catalogue is unavailable", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ stations: [] }));
    const s = await findNearestTideStation(55, -131);
    expect(s).toBeNull();
  });
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

describe("getTidePredictions window + cache TTL", () => {
  it("requests a 31-day window in english units against MLLW and caches it", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(predictionsBody()));
    const now = new Date("2026-07-18T10:30:00Z");

    const first = await getTidePredictions("9450460", now);
    expect(first).not.toBeNull();
    expect(first!.datum).toBe("MLLW");
    expect(first!.units).toBe("feet");
    expect(first!.windowStart).toBe("2026-07-18T00:00:00.000Z");
    const spanDays =
      (Date.parse(first!.windowEnd) - Date.parse(first!.windowStart)) / 86_400_000;
    expect(spanDays).toBe(TIDES_WINDOW_DAYS);

    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("product=predictions");
    expect(url).toContain("datum=MLLW");
    expect(url).toContain("units=english");
    expect(url).toContain("interval=6");
    expect(url).toContain("begin_date=20260718");
    expect(url).toContain("end_date=20260818");

    // Second call within TTL → served from cache, no extra NOAA fetch.
    const second = await getTidePredictions("9450460", now);
    expect(second).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(__tidesPredictionsCacheSizeForTests()).toBe(1);
  });

  it("re-fetches after the 24h TTL expires", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(predictionsBody()));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T01:00:00Z"));
    const now = new Date("2026-07-18T01:00:00Z");

    await getTidePredictions("9450460", now);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance past the TTL; keep the same window anchor (same `now` arg) so
    // only staleness — not the rolling window key — forces the refetch.
    vi.setSystemTime(new Date(Date.parse("2026-07-18T01:00:00Z") + TIDES_PREDICTIONS_TTL_MS + 1));
    await getTidePredictions("9450460", now);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("parses NOAA timestamps as UTC and drops non-finite values", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        predictions: [
          { t: "2026-07-18 00:00", v: "1.5" },
          { t: "2026-07-18 00:06", v: "not-a-number" },
        ],
      }),
    );
    const result = await getTidePredictions("9450460", new Date("2026-07-18T05:00:00Z"));
    expect(result!.predictions).toHaveLength(1);
    expect(result!.predictions[0]!.t).toBe("2026-07-18T00:00:00.000Z");
    expect(result!.predictions[0]!.v).toBe(1.5);
  });

  it("returns null when NOAA errors or returns no predictions", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: { message: "No data" } }));
    expect(await getTidePredictions("9450460")).toBeNull();
    __clearTidesPredictionsCacheForTests();
    fetchSpy.mockResolvedValue(jsonResponse({ predictions: [] }));
    expect(await getTidePredictions("9450460")).toBeNull();
  });
});

describe("GET /tides/:stationId", () => {
  it("400s on a malformed station id", async () => {
    const res = await request(makeApp()).get("/tides/abc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
  });

  it("returns the prediction window for a valid station", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(predictionsBody()));
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
