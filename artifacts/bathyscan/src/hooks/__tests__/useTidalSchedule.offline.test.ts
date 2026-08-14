/**
 * useTidalSchedule — offline fallback branch tests.
 *
 * Verifies: expiry gate, location-range gate, event derivation, station ID,
 * and normal online path.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { useTidalSchedule } from "../useTidalSchedule";

// Hourly predictions spanning 24 h (sine wave high/low pattern)
function makePredictions(count = 49): { t: string; v: number }[] {
  const start = Date.now() - 12 * 3600_000;
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(start + i * 3600_000).toISOString(),
    v: 3 + 3 * Math.sin((i / count) * 2 * Math.PI),
  }));
}

function makePack(overrides: Partial<EnvPack> = {}): EnvPack {
  const now = Date.now();
  const predictions = makePredictions();
  return {
    generatedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 7 * 24 * 3600_000).toISOString(),
    // SE Alaska — used as the pack centre for range checks
    centerLat: 57.05,
    centerLon: -135.33,
    coverageRadiusMiles: 15,
    tideStations: [
      {
        stationId: "9452210",
        name: "Juneau",
        lat: 58.3,
        lon: -134.41,
        distanceMiles: 8,
        windowStart: new Date(now - 3600_000).toISOString(),
        windowEnd: new Date(now + 14 * 24 * 3600_000).toISOString(),
        datum: "MLLW",
        units: "feet",
        predictions,
        datums: null,
      },
    ],
    weatherStations: null,
    marineConditions: null,
    temperatureProfile: null,
    warnings: [],
    ...overrides,
  };
}

function resetStores() {
  useOfflineStore.setState({ isOnline: true });
  useEnvOfflineStore.setState({ envPack: null, isDownloading: false, downloadError: null });
}

// Coordinates near the pack centre (within 15 mi radius)
const NEAR_LAT = 57.05;
const NEAR_LON = -135.33;
// Coordinates far from the pack (>15 mi, e.g. Seattle)
const FAR_LAT = 47.6;
const FAR_LON = -122.3;

describe("useTidalSchedule offline fallback", () => {
  beforeEach(() => {
    resetStores();
    global.fetch = vi.fn();
  });

  it("does NOT call fetch when offline", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns synthetic schedule with station info when offline and pack is valid and in range", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    expect(result.current.schedule).not.toBeNull();
    expect(result.current.schedule?.available).toBe(true);
    expect(result.current.schedule?.stationId).toBe("9452210");
    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("derives high/low events from the prediction series (not empty [])", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    const events = result.current.schedule?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    // Should have at least one high and one low
    expect(events.some((e) => e.type === "high")).toBe(true);
    expect(events.some((e) => e.type === "low")).toBe(true);
    // Each event has required fields
    for (const ev of events) {
      expect(ev.time).toBeTruthy();
      expect(typeof ev.height).toBe("number");
      expect(ev.windowStart).toBeTruthy();
      expect(ev.windowEnd).toBeTruthy();
    }
  });

  it("returns null schedule when offline and pack is EXPIRED", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    expect(result.current.schedule).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
  });

  it("returns null schedule when offline but requested location is OUT OF RANGE", () => {
    // Pack centre is SE Alaska; Seattle is well outside 15 mi
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useTidalSchedule(FAR_LAT, FAR_LON, 7));

    expect(result.current.schedule).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("returns null schedule when offline with no pack", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: null });
    });

    const { result } = renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    expect(result.current.schedule).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("calls fetch when online (normal path)", () => {
    const mockSchedule = {
      available: true,
      source: "noaa",
      rangeStart: new Date().toISOString(),
      rangeEnd: new Date().toISOString(),
      events: [],
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockSchedule,
    });

    act(() => useOfflineStore.setState({ isOnline: true }));
    renderHook(() => useTidalSchedule(NEAR_LAT, NEAR_LON, 7));

    expect(global.fetch).toHaveBeenCalled();
  });
});
