import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getCurrentsPeak,
  __clearCurrentsPeakCacheForTests,
} from "../tidal.js";

function buildNoaaResponse() {
  return {
    current_predictions: {
      cp: [
        { Type: "flood", Speed: "1.5", Direction: "90", meanFloodDir: "90" },
        { Type: "ebb", Speed: "1.2", Direction: "270" },
      ],
    },
  };
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(buildNoaaResponse()),
  } as unknown as Response);
}

describe("getCurrentsPeak caching", () => {
  let fetchSpy: ReturnType<typeof mockFetchOk>;

  beforeEach(() => {
    __clearCurrentsPeakCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00Z"));
    fetchSpy = mockFetchOk();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves the second call within the TTL from cache (no network)", async () => {
    const ref = new Date("2026-05-25T12:00:00Z");

    const first = await getCurrentsPeak("cb0102", ref);
    expect(first).toEqual({ peakSpeedKnots: 1.5, floodBearingDeg: 90 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance time but stay under the 30 min TTL.
    vi.setSystemTime(new Date("2026-05-25T12:25:00Z"));
    const second = await getCurrentsPeak("cb0102", ref);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL elapses", async () => {
    const ref = new Date("2026-05-25T12:00:00Z");

    await getCurrentsPeak("cb0102", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the 30 min TTL.
    vi.setSystemTime(new Date("2026-05-25T12:31:00Z"));
    await getCurrentsPeak("cb0102", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses separate cache entries for different stations", async () => {
    const ref = new Date("2026-05-25T12:00:00Z");

    await getCurrentsPeak("cb0102", ref);
    await getCurrentsPeak("PUG1515", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Each station should now be cached independently.
    await getCurrentsPeak("cb0102", ref);
    await getCurrentsPeak("PUG1515", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
