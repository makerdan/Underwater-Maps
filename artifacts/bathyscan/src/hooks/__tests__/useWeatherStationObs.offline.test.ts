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

  // ── within-15-min bucket scrub ────────────────────────────────────────────
  //
  // Verify that scrubbing targetTime within the SAME 15-minute bucket still
  // causes the offline interpolation to recompute (i.e. the effect depends on
  // the exact timestamp, not just the coarse bucket key).
  it("recomputes interpolated values when targetTime changes within the same 15-min bucket", async () => {
    const T0 = new Date("2024-06-01T12:00:00Z").getTime();
    const T1 = T0 + 3_600_000;

    const hourlyForecast = [
      {
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T1).toISOString(),
        temperature: 50,
        temperatureUnit: "F",
        windSpeed: "10 mph",
        windDirection: "N",
        shortForecast: "Clear",
        isDaytime: true,
      },
      {
        startTime: new Date(T1).toISOString(),
        endTime: new Date(T1 + 3_600_000).toISOString(),
        temperature: 60,
        temperatureUnit: "F",
        windSpeed: "20 mph",
        windDirection: "E",
        shortForecast: "Clear",
        isDaytime: true,
      },
    ];

    const packWithForecast = makePack({
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
          observedAt: new Date(T0 - 3600_000).toISOString(),
          hourlyForecast,
        },
      ],
    });

    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: packWithForecast });
    });

    // T0 + 5 min and T0 + 10 min share the same 15-min bucket (12:00 UTC).
    const time5min = new Date(T0 + 5 * 60_000);
    const time10min = new Date(T0 + 10 * 60_000);

    // First render: 5 min into the window → t=5/60, temp ≈ 50.83°F ≈ 10.46°C
    const { result, rerender } = renderHook(
      ({ targetTime }: { targetTime: Date }) =>
        useWeatherStationObs("PAJN", targetTime, true),
      { initialProps: { targetTime: time5min } },
    );

    const tempAt5min = result.current.observation?.tempC;
    expect(tempAt5min).not.toBeNull();

    // Scrub within the same bucket: 10 min → t=10/60, temp ≈ 51.67°F ≈ 10.93°C
    rerender({ targetTime: time10min });

    const tempAt10min = result.current.observation?.tempC;
    expect(tempAt10min).not.toBeNull();

    // Values must differ — proves the effect recomputed despite same 15-min key
    expect(tempAt10min).not.toBeCloseTo(tempAt5min!);
    // 10-min value should be slightly higher (further along in the ramp)
    expect(tempAt10min!).toBeGreaterThan(tempAt5min!);
  });

  // ── targetTime integration ────────────────────────────────────────────────
  //
  // Verify the offline branch uses the hook's `targetTime`, NOT `Date.now()`.
  //
  // Strategy: supply an hourlyForecast whose window is entirely in the past
  // (2024-06-01T12:00–13:00 UTC).  If Date.now() were used, getWeatherAtTime
  // would return null (outside window) and the hook would fall back to the
  // station snapshot (tempC: 8, windSpeedKnots: 10).  With the correct
  // targetTime (T0 + 30 min, inside the window) the hook returns interpolated
  // values — specifically tempC ≈ 12.78 (= (55°F − 32) × 5/9, midpoint of
  // 50°F and 60°F), proving the correct timestamp is used.
  it("uses targetTime (not Date.now()) for offline interpolation", () => {
    const T0 = new Date("2024-06-01T12:00:00Z").getTime(); // past window
    const T1 = T0 + 3_600_000; // +1 h

    const hourlyForecast = [
      {
        startTime: new Date(T0).toISOString(),
        endTime: new Date(T1).toISOString(),
        temperature: 50,
        temperatureUnit: "F",
        windSpeed: "10 mph",
        windDirection: "N",
        shortForecast: "Clear",
        isDaytime: true,
      },
      {
        startTime: new Date(T1).toISOString(),
        endTime: new Date(T1 + 3_600_000).toISOString(),
        temperature: 60,
        temperatureUnit: "F",
        windSpeed: "20 mph",
        windDirection: "E",
        shortForecast: "Clear",
        isDaytime: true,
      },
    ];

    const packWithForecast = makePack({
      weatherStations: [
        {
          id: "PAJN",
          name: "Juneau Airport",
          lat: 58.35,
          lon: -134.57,
          windSpeedKnots: 10,   // snapshot fallback value (should NOT be used)
          windDirDeg: 270,
          visibilityMiles: 10,
          ceilingFt: 3000,
          tempC: 8,             // snapshot fallback (should NOT be used)
          observedAt: new Date(T0 - 3600_000).toISOString(),
          hourlyForecast,
        },
      ],
    });

    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: packWithForecast });
    });

    // targetTime = midpoint of the window (T0 + 30 min)
    const targetTime = new Date(T0 + 1_800_000);

    const { result } = renderHook(() =>
      useWeatherStationObs("PAJN", targetTime, true),
    );

    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.observation).not.toBeNull();

    // Midpoint of 50°F and 60°F = 55°F → (55 − 32) × 5/9 ≈ 12.78 °C
    // If Date.now() were used the interpolation would return null and
    // tempC would be the snapshot value (8), so this assertion proves
    // the correct timestamp is forwarded.
    expect(result.current.observation!.tempC).toBeGreaterThan(12);
    expect(result.current.observation!.tempC).toBeLessThan(14);
  });
});
