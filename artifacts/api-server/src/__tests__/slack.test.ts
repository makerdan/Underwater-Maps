/**
 * Unit tests for the shared slack-tide model and API responses.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import {
  buildSyntheticEvents,
  computeSlackSample,
  SEMI_DIURNAL_MS,
  type TideEvent,
} from "../lib/slack";

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
    expect(res.body.slack).toBeDefined();
    expect(typeof res.body.slack.isSlack).toBe("boolean");
    expect(typeof res.body.slack.minutesToSlack).toBe("number");
    expect(typeof res.body.slack.minutesSinceSlack).toBe("number");
    expect(typeof res.body.slack.nextReversalAt).toBe("string");
    expect(["flooding", "ebbing", "slack-high", "slack-low"]).toContain(res.body.slack.phase);
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
});
