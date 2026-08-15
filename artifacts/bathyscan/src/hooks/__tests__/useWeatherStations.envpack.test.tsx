/**
 * useWeatherStations — env-pack offline fallback tests.
 *
 * Covers the second-tier offline fallback (mirroring useTidalData): when the
 * device is offline and the legacy per-dataset offline pack has no coverage,
 * the hook must serve weather stations from the downloaded env pack.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── idb-keyval mock ───────────────────────────────────────────────────────────
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

// ── React Query mock ──────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useGetWeatherStations: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
  getGetWeatherStationsQueryKey: vi.fn().mockReturnValue(["weather-stations"]),
}));

// ── Terrain context mock ──────────────────────────────────────────────────────
vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: { minLat: 57.0, maxLat: 57.1, minLon: -135.4, maxLon: -135.3 },
  }),
}));

// ── Legacy offline pack store mock (no coverage by default) ───────────────────
vi.mock("@/lib/offlinePackStore", () => ({
  getPackForLocation: vi.fn().mockResolvedValue(null),
  getOfflineWeatherValue: vi.fn().mockReturnValue(null),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { useWeatherStations } from "../useWeatherStations";
import { getPackForLocation, getOfflineWeatherValue } from "@/lib/offlinePackStore";

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

describe("useWeatherStations env-pack offline fallback", () => {
  beforeEach(() => {
    resetStores();
    (getPackForLocation as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getOfflineWeatherValue as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("serves env-pack stations when offline and legacy pack has no coverage", async () => {
    const pack = makePack();
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: pack });
    });

    const { result } = renderHook(() => useWeatherStations());

    await waitFor(() => {
      expect(result.current.stations).toHaveLength(1);
    });
    expect(result.current.stations[0]?.id).toBe("PAJN");
    expect(result.current.stations[0]?.isOfflinePack).toBe(true);
    expect(result.current.stations[0]?.snapshotAt).toBe(pack.generatedAt);
    expect(result.current.isOfflinePack).toBe(true);
    expect(result.current.weatherSnapshotAt).toBe(pack.generatedAt);
    expect(result.current.isError).toBe(false);
  });

  it("returns no stations when offline with no env pack and no legacy pack", async () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
    });

    const { result } = renderHook(() => useWeatherStations());

    await waitFor(() => {
      expect(result.current.stations).toHaveLength(0);
    });
    expect(result.current.isOfflinePack).toBe(false);
  });

  it("does not serve env-pack stations when the pack is EXPIRED", async () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(() => useWeatherStations());

    await waitFor(() => {
      expect(result.current.isOfflinePack).toBe(false);
    });
    expect(result.current.stations).toHaveLength(0);
  });

  it("does not serve env-pack stations when the pack has none", async () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack({ weatherStations: [] }) });
    });

    const { result } = renderHook(() => useWeatherStations());

    await waitFor(() => {
      expect(result.current.stations).toHaveLength(0);
    });
    expect(result.current.isOfflinePack).toBe(false);
  });

  it("prefers the legacy offline pack over the env pack when both exist", async () => {
    (getPackForLocation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "legacy" });
    (getOfflineWeatherValue as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "LEGACY",
      name: "Legacy Station",
      lat: 57.0,
      lon: -135.3,
      windSpeedKnots: 5,
      windDirDeg: 180,
      visibilityMiles: 8,
      ceilingFt: null,
      tempC: 6,
      observedAt: new Date().toISOString(),
      isStale: true,
      snapshotAt: "2026-08-14T00:00:00.000Z",
    });

    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useWeatherStations());

    await waitFor(() => {
      expect(result.current.stations[0]?.id).toBe("LEGACY");
    });
    expect(result.current.weatherSnapshotAt).toBe("2026-08-14T00:00:00.000Z");
  });

  it("ignores the env pack when ONLINE", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: true });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useWeatherStations());

    // Online path uses the (mocked, empty) query — never the pack.
    expect(result.current.stations).toHaveLength(0);
    expect(result.current.isOfflinePack).toBe(false);
  });
});
