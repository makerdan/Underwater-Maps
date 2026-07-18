/**
 * tides-datums.test.ts — Unit tests for getStationDatums (NOAA MHW/MHHW
 * datum resolution with 24 h in-memory caching).
 *
 * Mocks the global `fetch` so no live NOAA calls are made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getStationDatums,
  __clearTidesDatumsCacheForTests,
} from "../routes/tides.js";

const realFetch = globalThis.fetch;

function mockNoaaDatums(datums: Array<{ name: string; value: number }>) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ datums }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  __clearTidesDatumsCacheForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("getStationDatums", () => {
  it("returns MHW and MHHW in feet above MLLW", async () => {
    globalThis.fetch = mockNoaaDatums([
      { name: "MHHW", value: 15.42 },
      { name: "MHW", value: 14.53 },
      { name: "MLLW", value: 0.0 },
    ]) as typeof fetch;

    const result = await getStationDatums("9452210");
    expect(result).toEqual({
      stationId: "9452210",
      mhwFt: 14.53,
      mhhwFt: 15.42,
      datum: "MLLW",
      units: "feet",
    });
  });

  it("returns null fields for individually missing datums", async () => {
    globalThis.fetch = mockNoaaDatums([{ name: "MHW", value: 14.53 }]) as typeof fetch;
    const result = await getStationDatums("9452210");
    expect(result?.mhwFt).toBe(14.53);
    expect(result?.mhhwFt).toBeNull();
  });

  it("returns null when NOAA has no MHW/MHHW datums at all", async () => {
    globalThis.fetch = mockNoaaDatums([{ name: "MLLW", value: 0 }]) as typeof fetch;
    expect(await getStationDatums("9452210")).toBeNull();
  });

  it("returns null when NOAA is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;
    expect(await getStationDatums("9452210")).toBeNull();
  });

  it("serves the second request from cache without a second fetch", async () => {
    const fetchMock = mockNoaaDatums([
      { name: "MHW", value: 14.53 },
      { name: "MHHW", value: 15.42 },
    ]);
    globalThis.fetch = fetchMock as typeof fetch;

    const first = await getStationDatums("9452210");
    const second = await getStationDatums("9452210");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    globalThis.fetch = failing as typeof fetch;
    expect(await getStationDatums("9452210")).toBeNull();

    globalThis.fetch = mockNoaaDatums([{ name: "MHW", value: 10 }]) as typeof fetch;
    const retry = await getStationDatums("9452210");
    expect(retry?.mhwFt).toBe(10);
  });
});
