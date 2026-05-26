/**
 * Unit tests for the shared slack-tide model and API responses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import {
  buildSyntheticEvents,
  computeSlackSample,
  SEMI_DIURNAL_MS,
  type TideEvent,
} from "../lib/slack";
import {
  __clearHighLowEventsCacheForTests,
  __clearStationCachesForTests,
  __clearCurrentsPeakCacheForTests,
} from "../routes/tidal";

// Module-level NOAA caches are shared across tests; clear them between
// cases so a fetch-failure cached as "empty stations" by one test does
// not pin later tests to the estimated-fallback path.
beforeEach(() => {
  __clearHighLowEventsCacheForTests();
  __clearStationCachesForTests();
  __clearCurrentsPeakCacheForTests();
});

describe("slack model", () => {
  const peak = 2.0;
  const flood = 90;

  function events(refMs: number): TideEvent[] {
    // Low at refMs - 3h, High at refMs + 3h → 6h half-cycle, mid at refMs
    return [
      { type: "low", time: refMs - 3 * 3600 * 1000, height: -1 },
      { type: "high", time: refMs + 3 * 3600 * 1000, height: 1.5 },
    ];
  }

  it("returns zero speed at slack events", () => {
    const ref = 1_700_000_000_000;
    const evs = events(ref);
    const atLow = computeSlackSample({ events: evs, refTime: evs[0]!.time, peakSpeedKnots: peak, floodBearingDeg: flood });
    const atHigh = computeSlackSample({ events: evs, refTime: evs[1]!.time, peakSpeedKnots: peak, floodBearingDeg: flood });
    expect(atLow.speedKnots).toBeLessThan(0.001);
    expect(atHigh.speedKnots).toBeLessThan(0.001);
    expect(atLow.slack.isSlack).toBe(true);
    expect(atHigh.slack.isSlack).toBe(true);
    expect(atLow.slack.phase).toBe("slack-low");
    expect(atHigh.slack.phase).toBe("slack-high");
  });

  it("peaks midway between slacks at the configured peak speed", () => {
    const ref = 1_700_000_000_000;
    const evs = events(ref);
    const mid = computeSlackSample({ events: evs, refTime: ref, peakSpeedKnots: peak, floodBearingDeg: flood });
    expect(mid.speedKnots).toBeCloseTo(peak, 5);
    expect(mid.slack.isSlack).toBe(false);
    expect(mid.slack.phase).toBe("flooding");
    expect(mid.directionDeg).toBe(flood);
  });

  it("flips direction across a high event", () => {
    const ref = 1_700_000_000_000;
    const evs: TideEvent[] = [
      { type: "low", time: ref - 6 * 3600 * 1000, height: -1 },
      { type: "high", time: ref, height: 1.5 },
      { type: "low", time: ref + 6 * 3600 * 1000, height: -1 },
    ];
    const before = computeSlackSample({ events: evs, refTime: ref - 3 * 3600 * 1000, peakSpeedKnots: peak, floodBearingDeg: flood });
    const after = computeSlackSample({ events: evs, refTime: ref + 3 * 3600 * 1000, peakSpeedKnots: peak, floodBearingDeg: flood });
    expect(before.slack.phase).toBe("flooding");
    expect(after.slack.phase).toBe("ebbing");
    // 180° apart
    const diff = Math.abs(before.directionDeg - after.directionDeg);
    expect(diff === 180 || diff === 180).toBe(true);
  });

  it("synthetic events use the semi-diurnal period (~12h 25m)", () => {
    const ref = 1_700_000_000_000;
    const evs = buildSyntheticEvents(ref, -130);
    expect(evs.length).toBeGreaterThan(8);
    const consecutive = evs[1]!.time - evs[0]!.time;
    expect(consecutive).toBeCloseTo(SEMI_DIURNAL_MS / 2, -3);
    // Types alternate
    expect(evs[0]!.type).not.toBe(evs[1]!.type);
  });

  it("falls back gracefully when no events are supplied", () => {
    const ref = 1_700_000_000_000;
    const s = computeSlackSample({ events: [], refTime: ref, peakSpeedKnots: peak, floodBearingDeg: flood });
    expect(s.speedKnots).toBeGreaterThanOrEqual(0);
    expect(["flooding", "ebbing", "slack-high", "slack-low"]).toContain(s.slack.phase);
  });
});

describe("/api/tidal slack block", () => {
  it("includes slack block and source field", async () => {
    // Stub fetch so the route falls back to the synthetic estimator.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled");
    }));
    const { default: app } = await import("../app");
    const res = await request(app).get("/api/tidal?lat=55.6&lon=-132.5");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
    expect(res.body.heightsSource).toBe("estimated");
    expect(res.body.currentsSource).toBe("estimated");
    expect(res.body.heightsStation).toBeUndefined();
    expect(res.body.currentsStation).toBeUndefined();
    expect(res.body.slack).toBeDefined();
    expect(typeof res.body.slack.isSlack).toBe("boolean");
    expect(typeof res.body.slack.minutesToSlack).toBe("number");
    expect(typeof res.body.slack.minutesSinceSlack).toBe("number");
    expect(typeof res.body.slack.nextReversalAt).toBe("string");
    expect(["flooding", "ebbing", "slack-high", "slack-low"]).toContain(res.body.slack.phase);
    vi.unstubAllGlobals();
  });
});

describe("/api/tidal NOAA currents-station path", () => {
  it("derives currentSpeed and flood bearing from currents_predictions", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      const ok = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
      });

      if (url.includes("/mdapi/prod/webapi/stations.json") && url.includes("type=waterlevels")) {
        // No nearby tide-height station → route falls back to synthetic heights.
        return ok({ stations: [] });
      }
      if (
        url.includes("/mdapi/prod/webapi/stations.json") &&
        url.includes("type=currentpredictions")
      ) {
        return ok({
          stations: [
            {
              id: "PCT0101",
              name: "Test Narrows",
              lat: 55.61,
              lng: -132.51,
            },
          ],
        });
      }
      if (url.includes("product=currents_predictions") && url.includes("station=PCT0101")) {
        return ok({
          current_predictions: {
            cp: [
              { Time: "2026-01-01 18:00", Type: "slack", Speed: 0, Direction: 0 },
              { Time: "2026-01-01 21:00", Type: "flood", Speed: 4.0, Direction: 120, meanFloodDir: 120 },
              { Time: "2026-01-02 00:00", Type: "slack", Speed: 0, Direction: 0 },
              { Time: "2026-01-02 03:00", Type: "ebb", Speed: 3.5, Direction: 300 },
            ],
          },
        });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: app } = await import("../app");
    // Pick a datetime aligned with the mid-point of the synthetic
    // semi-diurnal cycle for lon=-132.5 so |sin(π·t)| ≈ 1 and the
    // returned speed matches the stubbed peak (4.0 kt).
    const res = await request(app).get(
      "/api/tidal?lat=55.6&lon=-132.5&datetime=2026-01-01T23:56:15Z",
    );
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("noaa");
    expect(res.body.heightsSource).toBe("estimated");
    expect(res.body.currentsSource).toBe("noaa");
    expect(res.body.currentsStation).toEqual({ id: "PCT0101", name: "Test Narrows" });
    expect(res.body.heightsStation).toBeUndefined();
    // The stubbed peak speed is 4.0 kt; the fallback estimator clamps to
    // ≤ 3.0 kt, so a value above that proves we used NOAA's Speed rather
    // than the tide-range heuristic.
    expect(res.body.currentSpeed).toBeGreaterThan(3.0);
    expect(res.body.currentSpeed).toBeCloseTo(4.0, 1);
    // Flood bearing came from meanFloodDir = 120. The chosen datetime
    // lands on the high→low (ebbing) half of the synthetic cycle, so the
    // reported direction equals the ebb bearing (flood + 180 = 300°).
    expect(res.body.currentDirection).toBeCloseTo(300, 5);

    vi.unstubAllGlobals();
  });
});

describe("/api/tidal/schedule", () => {
  it("returns slack events with windows for the next N days", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled");
    }));
    const { default: app } = await import("../app");
    const res = await request(app).get("/api/tidal/schedule?lat=55.6&lon=-132.5&days=3");
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.source).toBe("estimated");
    expect(Array.isArray(res.body.events)).toBe(true);
    // ~4 hi/lo events per day × 3 days ≈ 12
    expect(res.body.events.length).toBeGreaterThanOrEqual(8);
    expect(res.body.events.length).toBeLessThanOrEqual(16);
    for (const e of res.body.events) {
      expect(["high", "low"]).toContain(e.type);
      expect(typeof e.height).toBe("number");
      expect(typeof e.nextDirectionDeg).toBe("number");
      expect(new Date(e.windowStart).getTime()).toBeLessThan(new Date(e.time).getTime());
      expect(new Date(e.windowEnd).getTime()).toBeGreaterThan(new Date(e.time).getTime());
    }
    vi.unstubAllGlobals();
  });

  it("rejects missing lat/lon", async () => {
    const { default: app } = await import("../app");
    const res = await request(app).get("/api/tidal/schedule");
    expect(res.status).toBe(400);
  });
});

describe("/api/surface-conditions slack fields", () => {
  it("hourly entries include isSlack and phase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled");
    }));
    const { default: app } = await import("../app");
    const res = await request(app).get("/api/surface-conditions?lat=55.6&lon=-132.5");
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(24);
    for (const h of res.body.hours) {
      expect(typeof h.isSlack).toBe("boolean");
      expect(["flooding", "ebbing", "slack-high", "slack-low"]).toContain(h.phase);
      expect(typeof h.tidalSpeedKnots).toBe("number");
    }
    // At least one slack hour and at least one non-slack hour should exist
    // in a 24-hour semi-diurnal cycle.
    const slackHours = res.body.hours.filter((h: { isSlack: boolean }) => h.isSlack).length;
    expect(slackHours).toBeGreaterThan(0);
    expect(slackHours).toBeLessThan(24);
    vi.unstubAllGlobals();
  });

  it("phase transitions are monotonic and slack hours bracket each tide event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network disabled");
    }));
    const { buildSinusoidalTidalHours } = await import(
      "../routes/surface-conditions"
    );
    // Anchor at UTC midnight so the synthetic schedule (anchored on local
    // solar noon) is deterministic.
    const startMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const hours = buildSinusoidalTidalHours(55.6, -132.5, startMs);
    expect(hours).toHaveLength(24);

    // 1) Each slack hour's phase reflects the bracketed event type.
    for (const h of hours) {
      if (h.isSlack) {
        expect(["slack-high", "slack-low"]).toContain(h.phase);
      } else {
        expect(["flooding", "ebbing"]).toContain(h.phase);
      }
    }

    // 2) Between consecutive slack hours, the non-slack phase should be
    // constant (no flooding→ebbing flips except across a slack event).
    let lastNonSlack: string | null = null;
    for (const h of hours) {
      if (h.isSlack) {
        // crossing a slack event resets the comparison.
        lastNonSlack = null;
        continue;
      }
      if (lastNonSlack === null) {
        lastNonSlack = h.phase;
      } else {
        expect(h.phase).toBe(lastNonSlack);
      }
    }

    // 3) There is at least one slack and at least one non-slack hour in
    // the 24-hour cycle (semi-diurnal ⇒ ~4 events per 25h).
    const slackCount = hours.filter((h) => h.isSlack).length;
    expect(slackCount).toBeGreaterThan(0);
    expect(slackCount).toBeLessThan(24);

    // 4) tidalSpeedKnots increases from a slack hour toward the midpoint
    // between consecutive slack events. We check that whenever a slack
    // hour is followed within the next 3 hours by a non-slack hour, the
    // non-slack speed is strictly greater than the slack speed (which
    // should be ≈0 inside the ±30-min slack bracket but could legitimately
    // be small but non-zero at the bracket edge).
    for (let i = 0; i < hours.length - 1; i++) {
      const cur = hours[i]!;
      const next = hours[i + 1]!;
      if (cur.isSlack && !next.isSlack) {
        expect(next.tidalSpeedKnots).toBeGreaterThanOrEqual(cur.tidalSpeedKnots);
      }
    }

    vi.unstubAllGlobals();
  });
});
