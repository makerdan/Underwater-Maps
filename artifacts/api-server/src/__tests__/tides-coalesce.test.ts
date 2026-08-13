/**
 * tides-coalesce.test.ts — Verifies that concurrent cache-miss requests for
 * the same station/window are coalesced into a single NOAA HTTP fetch.
 *
 * Two simultaneous calls for the same key must each resolve with the correct
 * result while `fetch` is invoked exactly once.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getTidePredictions,
  getStationDatums,
  __clearTidesPredictionsCacheForTests,
  __clearTidesDatumsCacheForTests,
} from "../routes/tides.js";

const realFetch = globalThis.fetch;

const STATION_ID = "9447130";

// ── helpers ──────────────────────────────────────────────────────────────────

function makePredictionsResponse() {
  return new Response(
    JSON.stringify({
      predictions: [
        { t: "2026-08-13 00:00", v: "3.14" },
        { t: "2026-08-13 00:06", v: "3.20" },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeDatumsResponse() {
  return new Response(
    JSON.stringify({
      datums: [
        { name: "MHW", value: 14.53 },
        { name: "MHHW", value: 15.42 },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  __clearTidesPredictionsCacheForTests();
  __clearTidesDatumsCacheForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ── getTidePredictions coalescing ─────────────────────────────────────────────

describe("getTidePredictions — concurrent coalescing", () => {
  it("issues exactly one fetch when two concurrent cache-miss requests arrive for the same key", async () => {
    const fetchMock = vi.fn(async () => makePredictionsResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const now = new Date("2026-08-13T00:00:00Z");

    // Fire both requests simultaneously (no await between them)
    const [first, second] = await Promise.all([
      getTidePredictions(STATION_ID, now),
      getTidePredictions(STATION_ID, now),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.stationId).toBe(STATION_ID);
  });

  it("does not coalesce requests for different stations", async () => {
    const fetchMock = vi.fn(async () => makePredictionsResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const now = new Date("2026-08-13T00:00:00Z");

    await Promise.all([
      getTidePredictions("9447130", now),
      getTidePredictions("9452210", now),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes the in-flight entry after a failed fetch so the next call retries", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("network error");
    });
    globalThis.fetch = failingFetch as typeof fetch;

    const now = new Date("2026-08-13T00:00:00Z");
    const result = await getTidePredictions(STATION_ID, now);
    expect(result).toBeNull();

    // After failure the in-flight entry must be gone; a fresh call should retry
    const successFetch = vi.fn(async () => makePredictionsResponse());
    globalThis.fetch = successFetch as typeof fetch;

    const retry = await getTidePredictions(STATION_ID, now);
    expect(retry).not.toBeNull();
    expect(successFetch).toHaveBeenCalledTimes(1);
  });
});

// ── getStationDatums coalescing ───────────────────────────────────────────────

describe("getStationDatums — concurrent coalescing", () => {
  it("issues exactly one fetch when two concurrent cache-miss requests arrive for the same station", async () => {
    const fetchMock = vi.fn(async () => makeDatumsResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    const [first, second] = await Promise.all([
      getStationDatums(STATION_ID),
      getStationDatums(STATION_ID),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.stationId).toBe(STATION_ID);
  });

  it("does not coalesce requests for different stations", async () => {
    const fetchMock = vi.fn(async () => makeDatumsResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await Promise.all([
      getStationDatums("9447130"),
      getStationDatums("9452210"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("removes the in-flight entry after a failed fetch so the next call retries", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("network error");
    });
    globalThis.fetch = failingFetch as typeof fetch;

    const result = await getStationDatums(STATION_ID);
    expect(result).toBeNull();

    const successFetch = vi.fn(async () => makeDatumsResponse());
    globalThis.fetch = successFetch as typeof fetch;

    const retry = await getStationDatums(STATION_ID);
    expect(retry).not.toBeNull();
    expect(successFetch).toHaveBeenCalledTimes(1);
  });
});
