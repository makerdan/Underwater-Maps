/**
 * useWeatherStationObs — offline fallback branch tests.
 *
 * Covers: expiry gate, station-ID match gate, location range, and happy path.
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
import { useWeatherStationObs } from "../useWeatherStationObs";

function makePack(overrides: Partial<EnvPack> = {}): EnvPack {
  return {
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    centerLat: 57.05,
    centerLon: -135.33,
    coverageRadiusMiles: 15,
    tideStations: null,
    weatherStations: [
      {
        id: "PAJN",
        name: "Juneau Airport",
        lat: 58.35,
        lon: -134.57,
        windSpeedKnots: 10,
        windDirDeg: 270,
        visibilityMiles: 10,
        ceilingFt: 3000,
        tempC: 8,
        observedAt: new Date(Date.now() - 3600_000).toISOString(),
        hourlyForecast: null,
      },
    ],
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

describe("useWeatherStationObs offline fallback", () => {
  beforeEach(() => {
    resetStores();
    global.fetch = vi.fn();
  });

  it("returns weather observation from pack when offline and stationId matches", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", new Date(), true),
    );

    expect(result.current.observation).not.toBeNull();
    expect(result.current.observation?.windSpeedKnots).toBe(10);
    expect(result.current.observation?.tempC).toBe(8);
    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null when offline and stationId does NOT match any packed station", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    // "KSJC" is not in the pack; should NOT serve PAJN data for it
    const { result } = renderHook(() =>
      useWeatherStationObs("KSJC", new Date(), true),
    );

    expect(result.current.observation).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("returns null when offline and pack is EXPIRED", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", new Date(), true),
    );

    expect(result.current.observation).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
  });

  it("returns null when offline with no pack", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: null });
    });

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", new Date(), true),
    );

    expect(result.current.observation).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("returns null when offline, pack has no weather stations", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack({ weatherStations: null }) });
    });

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", new Date(), true),
    );

    expect(result.current.observation).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
  });

  it("resets state when not enabled", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", new Date(), false),
    );

    expect(result.current.observation).toBeNull();
    expect(result.current.isCachedPack).toBe(false);
  });
});
