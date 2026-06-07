/**
 * noaaWeatherFetcher.test.ts — Unit tests for the NOAA weather station fetcher
 * DB persistence and fallback path.
 *
 * Four cases are covered:
 *   1. A successful live fetch upserts a row into weather_station_cache.
 *   2. When NOAA throws, a <1 h old DB row is returned with stale:true.
 *   3. When the DB row is >1 h old, the error is re-thrown.
 *   4. When no DB row exists, the error is re-thrown.
 *
 * The global `fetch` is stubbed per-test so no real network calls are made.
 * The @workspace/db module is fully mocked so no real DB is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NoaaUnavailableError } from "../lib/noaaWeatherFetcher";

// ---------------------------------------------------------------------------
// Hoist mock function refs so they are available both inside vi.mock() factory
// (which is hoisted above all imports) and in the test bodies below.
// ---------------------------------------------------------------------------

const {
  insertMock,
  valuesMock,
  onConflictDoUpdateMock,
  selectMock,
  fromMock,
  whereMock,
  limitMock,
} = vi.hoisted(() => {
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

  const limitMock = vi.fn().mockResolvedValue([]);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  const selectMock = vi.fn().mockReturnValue({ from: fromMock });

  return {
    insertMock,
    valuesMock,
    onConflictDoUpdateMock,
    selectMock,
    fromMock,
    whereMock,
    limitMock,
  };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({ db: { insert: insertMock, select: selectMock } });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

import { fetchWeatherStations } from "../lib/noaaWeatherFetcher.js";

// ---------------------------------------------------------------------------
// Constants for test coordinates (Gulf of Alaska, within NOAA coverage)
// ---------------------------------------------------------------------------

const LAT = 60.0;
const LON = -150.0;

// ---------------------------------------------------------------------------
// NOAA response builders
// Fetch is called in order: /points → /stations → /stations/{id}/observations/latest
// ---------------------------------------------------------------------------

function makePointsResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      properties: { relativeLocation: { properties: { state: "AK" } } },
    }),
  } as unknown as Response;
}

function makeStationsResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      features: [
        {
          properties: { stationIdentifier: "PAOM", name: "Nome Airport" },
          geometry: { coordinates: [LON, LAT] },
        },
      ],
    }),
  } as unknown as Response;
}

function makeObsResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      properties: {
        timestamp: "2024-01-01T12:00:00Z",
        windSpeed: { value: 5.0, unitCode: "wmoUnit:m_s-1" },
        windDirection: { value: 270 },
        visibility: { value: 16093.44, unitCode: "wmoUnit:m" },
        cloudLayers: [],
        temperature: { value: -5.0 },
      },
    }),
  } as unknown as Response;
}

// A sample result that would be stored in the DB
const CACHED_RESULT = {
  stations: [
    {
      id: "PAOM",
      name: "Nome Airport",
      lat: LAT,
      lon: LON,
      windSpeedKnots: 9.7,
      windDirDeg: 270,
      visibilityMiles: 10.0,
      ceilingFt: null,
      tempC: -5.0,
      observedAt: "2024-01-01T12:00:00Z",
    },
  ],
  stateCode: "AK",
  faaWeatherCamsUrl: "https://weathercams.faa.gov/cameras/state/AK",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush the microtask queue so fire-and-forget promises (persistToDb) settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchWeatherStations — DB persistence and cache fallback", () => {
  beforeEach(() => {
    // Restore default mock implementations before each test so previous
    // vi.clearAllMocks() calls don't leave the chains broken.
    onConflictDoUpdateMock.mockResolvedValue(undefined);
    valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    insertMock.mockReturnValue({ values: valuesMock });

    limitMock.mockResolvedValue([]);
    whereMock.mockReturnValue({ limit: limitMock });
    fromMock.mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Successful live fetch → DB upsert
  // ─────────────────────────────────────────────────────────────────────────

  it("upserts a row into weather_station_cache after a successful NOAA fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(makePointsResponse())
        .mockResolvedValueOnce(makeStationsResponse())
        .mockResolvedValueOnce(makeObsResponse()),
    );

    const result = await fetchWeatherStations(LAT, LON);

    // Should return live data without the stale flag
    expect(result.stale).toBeUndefined();
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.id).toBe("PAOM");
    expect(result.stateCode).toBe("AK");

    // Allow the fire-and-forget persistToDb promise to settle
    await flushMicrotasks();

    // DB insert chain should have been invoked once with the cache key and result
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: expect.any(String),
        result: expect.objectContaining({ stations: expect.any(Array) }),
        fetchedAt: expect.any(Date),
      }),
    );
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. NOAA down + fresh DB row → stale:true
  // ─────────────────────────────────────────────────────────────────────────

  it("returns stale:true from DB when NOAA throws and the cached row is <1 hour old", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    limitMock.mockResolvedValueOnce([
      { result: CACHED_RESULT, fetchedAt: thirtyMinutesAgo },
    ]);

    const result = await fetchWeatherStations(LAT, LON);

    expect(result.stale).toBe(true);
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]!.id).toBe("PAOM");
    expect(result.stateCode).toBe("AK");

    // DB select should have been queried for the fallback; insert should NOT
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. NOAA down + stale DB row (>1 h) → error re-thrown
  // ─────────────────────────────────────────────────────────────────────────

  it("re-throws a NoaaUnavailableError when the DB row is older than 1 hour", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection timeout")));

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    limitMock.mockResolvedValueOnce([
      { result: CACHED_RESULT, fetchedAt: twoHoursAgo },
    ]);

    await expect(fetchWeatherStations(LAT, LON)).rejects.toBeInstanceOf(NoaaUnavailableError);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. NOAA down + no DB row → error re-thrown
  // ─────────────────────────────────────────────────────────────────────────

  it("re-throws a NoaaUnavailableError when no DB row exists for the cache key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS resolution failed")));

    // limitMock already defaults to [] in beforeEach
    limitMock.mockResolvedValueOnce([]);

    await expect(fetchWeatherStations(LAT, LON)).rejects.toBeInstanceOf(NoaaUnavailableError);

    // DB select should have been tried; insert should NOT
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
