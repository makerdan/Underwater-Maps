import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getHighLowEvents } from "../tidal.js";

function buildNoaaResponse() {
  return {
    predictions: [
      { t: "2026-05-25 06:00", v: "2.1", type: "H" as const },
      { t: "2026-05-25 12:30", v: "0.3", type: "L" as const },
      { t: "2026-05-25 18:45", v: "2.4", type: "H" as const },
    ],
  };
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(buildNoaaResponse()),
  } as unknown as Response);
}

describe("getHighLowEvents caching", () => {
  let fetchSpy: ReturnType<typeof mockFetchOk>;

  beforeEach(() => {
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

    const first = await getHighLowEvents("8454000", ref);
    expect(first).not.toBeNull();
    expect(first).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Advance time but stay under the 30 min TTL.
    vi.setSystemTime(new Date("2026-05-25T12:25:00Z"));
    const second = await getHighLowEvents("8454000", ref);
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL elapses", async () => {
    const ref = new Date("2026-05-25T12:00:00Z");

    await getHighLowEvents("8454000", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past the 30 min TTL.
    vi.setSystemTime(new Date("2026-05-25T12:31:00Z"));
    await getHighLowEvents("8454000", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses separate cache entries for different stations", async () => {
    const ref = new Date("2026-05-25T12:00:00Z");

    await getHighLowEvents("8454000", ref);
    await getHighLowEvents("9447130", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Each station should now be cached independently.
    await getHighLowEvents("8454000", ref);
    await getHighLowEvents("9447130", ref);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses separate cache entries for different day windows", async () => {
    const ref1 = new Date("2026-05-25T12:00:00Z");
    const ref2 = new Date("2026-05-28T12:00:00Z");

    await getHighLowEvents("8454000", ref1);
    await getHighLowEvents("8454000", ref2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
