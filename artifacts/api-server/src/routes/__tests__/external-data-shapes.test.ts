/**
 * external-data-shapes.test.ts — Regression guards for NOAA / external data
 * connection bugs (audit task 3733).
 *
 * Covers:
 *   C-1  Pack currents: NOAA wraps current_predictions in {cp:[...]} envelope;
 *        mistyping it as a direct array silently empties offline current arrows.
 *   C-2  Bearing formula: JS % is remainder, not modulo; western-hemisphere
 *        coordinates must always produce a bearing in [0, 360).
 *   M-1  NaN / sentinel heights: NOAA "" or "9999" v-fields must be dropped.
 *   M-2  USGS source label: the USGS path serves synthetic (modelled) heights,
 *        not real gage data — source must be "estimated" not "usgs".
 *   Argo orderBy: buildArgoQueryUrl must request most-recent data via
 *        orderByMax("time"), not orderByLimit which can surface stale floats.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Shared clerk mocks (required for any import that transitively touches auth)
// ---------------------------------------------------------------------------
vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));
vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// C-1: Pack currents — NOAA {cp:[...]} envelope
// ---------------------------------------------------------------------------

describe("C-1 · /tidal/pack currents shape — {cp:[...]} envelope", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns non-empty currentPredictions when NOAA wraps cp in the {cp:[...]} envelope", async () => {
    // The real NOAA currents_predictions?interval=MAX_SLACK shape — the
    // array lives INSIDE current_predictions.cp, not at the top level.
    const noaaCurrentsResponse = {
      current_predictions: {
        cp: [
          { Time: "2026-05-25 13:00", Type: "flood",   Speed: "1.4", Direction: "90"  },
          { Time: "2026-05-25 16:00", Type: "slack",   Speed: "0.1", Direction: "0"   },
          { Time: "2026-05-25 19:00", Type: "ebb",     Speed: "1.1", Direction: "270" },
        ],
      },
    };

    fetchSpy = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      // Stations lists
      if (u.includes("stations.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            stations: [
              { id: "9999999", name: "Mock Heights", lat: 47.6, lng: -122.3 },
            ],
          }),
        } as unknown as Response);
      }
      // Hi/lo predictions for height station
      if (u.includes("product=predictions") && u.includes("hilo")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            predictions: [
              { t: "2026-05-25 06:00", v: "2.1", type: "H" },
              { t: "2026-05-25 12:30", v: "0.3", type: "L" },
            ],
          }),
        } as unknown as Response);
      }
      // 6-minute height predictions for pack
      if (u.includes("product=predictions") && u.includes("interval=6")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ predictions: [] }),
        } as unknown as Response);
      }
      // Currents predictions (the shape being tested)
      if (u.includes("currents_predictions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(noaaCurrentsResponse),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stations: [] }),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchSpy);

    // Import fresh so caches start empty
    const { default: tidalRouter, __clearStationListCachesForTests } = await import("../tidal.js");
    __clearStationListCachesForTests();

    const app = express();
    app.use(tidalRouter);

    const res = await request(app).get("/tidal/pack?lat=47.6&lon=-122.3&days=3");
    expect(res.status).toBe(200);
    // C-1 regression: must not be empty — the {cp:[...]} envelope must be unwrapped
    expect(res.body.currentPredictions).toBeDefined();
    expect((res.body.currentPredictions as unknown[]).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// C-2: Bearing formula — western hemisphere must always produce [0, 360)
// ---------------------------------------------------------------------------

describe("C-2 · Bearing formula — western-hemisphere coordinates always in [0, 360)", () => {
  // The formula (((lat + lon) * 73.1) % 360 + 360) % 360 is used as the
  // estimated flood bearing when no NOAA currents station is found.
  // Previous form ((lat+lon)*73.1+360)%360 returned negative values when
  // (lat+lon)*73.1 < -360, e.g. Gulf of Mexico (lat=25, lon=-100).
  const bearingFormula = (lat: number, lon: number): number =>
    (((lat + lon) * 73.1) % 360 + 360) % 360;

  const westernCoords: [number, number, string][] = [
    [25, -100, "Gulf of Mexico"],
    [29, -90,  "Louisiana coast"],
    [21, -157, "Hawaii"],
    [30, -120, "California offshore"],
    [48, -125, "Pacific Northwest"],
    [60, -150, "South-central Alaska"],
  ];

  for (const [lat, lon, label] of westernCoords) {
    it(`produces bearing in [0, 360) for ${label} (lat=${lat}, lon=${lon})`, () => {
      const bearing = bearingFormula(lat, lon);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    });
  }

  it("produces a different (incorrect) result with the old buggy formula for Gulf of Mexico", () => {
    // Document that the old formula was wrong
    const lat = 25, lon = -100;
    const buggyFormula = ((lat + lon) * 73.1 + 360) % 360;
    const fixedFormula = (((lat + lon) * 73.1) % 360 + 360) % 360;
    // Buggy formula returns negative here
    expect(buggyFormula).toBeLessThan(0);
    // Fixed formula is always non-negative
    expect(fixedFormula).toBeGreaterThanOrEqual(0);
    expect(fixedFormula).toBeLessThan(360);
  });
});

// ---------------------------------------------------------------------------
// M-1: NaN / sentinel height filtering in getHighLowEvents
// ---------------------------------------------------------------------------

describe("M-1 · getHighLowEvents — NaN and sentinel heights are dropped", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops entries with empty string v (NaN after parseFloat)", async () => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          predictions: [
            { t: "2026-06-01 06:00", v: "",      type: "H" }, // empty → NaN, dropped
            { t: "2026-06-01 12:30", v: "0.3",   type: "L" }, // valid
            { t: "2026-06-01 18:45", v: "2.4",   type: "H" }, // valid
          ],
        }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { getHighLowEvents, __clearHighLowEventsCacheForTests } = await import("../tidal.js");
    __clearHighLowEventsCacheForTests();

    const events = await getHighLowEvents("8454000", new Date("2026-06-01T12:00:00Z"));
    expect(events).not.toBeNull();
    // The empty-v entry must have been dropped — only 2 valid events remain
    expect(events).toHaveLength(2);
    for (const e of events!) {
      expect(Number.isFinite(e.height)).toBe(true);
    }
  });

  it("drops entries with NOAA sentinel value 9999", async () => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          predictions: [
            { t: "2026-06-01 06:00", v: "9999", type: "H" }, // sentinel, dropped
            { t: "2026-06-01 12:30", v: "0.3",  type: "L" }, // valid
          ],
        }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { getHighLowEvents, __clearHighLowEventsCacheForTests } = await import("../tidal.js");
    __clearHighLowEventsCacheForTests();

    const events = await getHighLowEvents("8454001", new Date("2026-06-01T12:00:00Z"));
    expect(events).not.toBeNull();
    expect(events).toHaveLength(1);
    expect(events![0]!.height).toBeCloseTo(0.3);
  });

  it("keeps all events when all v values are valid finite heights", async () => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          predictions: [
            { t: "2026-06-01 06:00", v: "2.1", type: "H" },
            { t: "2026-06-01 12:30", v: "0.3", type: "L" },
            { t: "2026-06-01 18:45", v: "2.4", type: "H" },
          ],
        }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { getHighLowEvents, __clearHighLowEventsCacheForTests } = await import("../tidal.js");
    __clearHighLowEventsCacheForTests();

    const events = await getHighLowEvents("8454002", new Date("2026-06-01T12:00:00Z"));
    expect(events).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// M-2: USGS path must not fabricate a height when the station has no reading.
// ---------------------------------------------------------------------------

describe("M-2 · USGS path — no station value means explicitly unavailable", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns unavailable when a nearby USGS station has no gage-height value", async () => {
    fetchSpy = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      // NOAA station lists — empty so we fall through to freshwater path
      if (u.includes("stations.json")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ stations: [] }),
        } as unknown as Response);
      }
      // USGS NWIS returns one station
      if (u.includes("waterservices.usgs.gov")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              value: {
                timeSeries: [
                  {
                    sourceInfo: {
                      siteName: "Mississippi R at Memphis",
                      siteCode: [{ value: "07032000" }],
                      geoLocation: {
                        geogLocation: { latitude: 35.1, longitude: -90.1 },
                      },
                    },
                  },
                ],
              },
            }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stations: [] }),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const {
      default: tidalRouter,
      __clearStationListCachesForTests,
      __clearHighLowEventsCacheForTests,
    } = await import("../tidal.js");
    __clearStationListCachesForTests();
    __clearHighLowEventsCacheForTests();

    const app = express();
    app.use(tidalRouter);

    const res = await request(app).get(
      "/tidal?lat=35.1&lon=-90.1&waterType=freshwater",
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: false,
      source: "unavailable",
      unavailableReason: "freshwater_no_compatible_observation",
    });
  });
});

// ---------------------------------------------------------------------------
// Argo orderBy — buildArgoQueryUrl must use orderByMax("time")
// ---------------------------------------------------------------------------

describe("Argo M-3 · buildArgoQueryUrl uses orderByMax(\"time\") for recency", () => {
  it("URL contains orderByMax(\"time\") not orderByLimit", async () => {
    const { buildArgoQueryUrl } = await import("../../lib/argoErddap.js");
    const url = buildArgoQueryUrl(55.0, -132.0, new Date("2026-06-01T00:00:00Z"));
    expect(url).toContain('orderByMax("time")');
    expect(url).not.toContain("orderByLimit");
  });

  it("URL still contains required column list and bbox constraints", async () => {
    const { buildArgoQueryUrl } = await import("../../lib/argoErddap.js");
    const url = buildArgoQueryUrl(55.0, -132.0, new Date("2026-06-01T00:00:00Z"));
    expect(url).toContain("platform_number");
    expect(url).toContain("latitude>=53");
    expect(url).toContain("latitude<=57");
    expect(url).toContain("temp!=NaN");
  });
});
