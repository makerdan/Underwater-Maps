/**
 * useTemperatureProfile — offline fallback branch tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTemperatureProfile: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  getGetTemperatureProfileQueryKey: vi.fn().mockReturnValue(["temp-profile"]),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { useTemperatureProfile } from "../useTemperatureProfile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function makePack(overrides: Partial<EnvPack> = {}): EnvPack {
  return {
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    centerLat: 57.05,
    centerLon: -135.33,
    coverageRadiusMiles: 15,
    tideStations: null,
    weatherStations: null,
    marineConditions: null,
    temperatureProfile: {
      available: true,
      samples: [
        { depthM: 0, temperatureC: 9.5 },
        { depthM: 10, temperatureC: 8.0 },
        { depthM: 25, temperatureC: 6.5 },
      ],
      source: "HYCOM",
      sourceUrl: null,
      timestamp: new Date().toISOString(),
      provider: "HYCOM",
    },
    warnings: [],
    ...overrides,
  };
}

function resetStores() {
  useOfflineStore.setState({ isOnline: true });
  useEnvOfflineStore.setState({ envPack: null, isDownloading: false, downloadError: null });
}

describe("useTemperatureProfile offline fallback", () => {
  beforeEach(() => {
    resetStores();
  });

  it("returns temperature profile from env pack when offline", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(
      () => useTemperatureProfile(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.profile).not.toBeNull();
    expect(result.current.profile?.available).toBe(true);
    expect(result.current.profile?.samples).toHaveLength(3);
    expect(result.current.profile?.samples?.[0]?.depthM).toBe(0);
    expect(result.current.profile?.samples?.[0]?.temperatureC).toBe(9.5);
    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("returns null profile when offline with no pack", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: null });
    });

    const { result } = renderHook(
      () => useTemperatureProfile(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.profile).toBeNull();
  });

  it("returns null when offline, pack has unavailable profile", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({
          temperatureProfile: {
            available: false,
            samples: [],
            source: "none",
            sourceUrl: null,
            timestamp: null,
            provider: "none",
          },
        }),
      });
    });

    const { result } = renderHook(
      () => useTemperatureProfile(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.profile).toBeNull();
    expect(result.current.isCachedPack).toBe(true);
  });

  it("returns null when offline and pack is expired", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(
      () => useTemperatureProfile(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    // Expired pack — should not serve cached data (falls through to React Query path)
    expect(result.current.isCachedPack).toBeUndefined();
  });

  it("uses React Query when online (normal path)", () => {
    act(() => useOfflineStore.setState({ isOnline: true }));

    const { result } = renderHook(
      () => useTemperatureProfile(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.profile).toBeNull(); // mock returns undefined → null
    expect(result.current.isCachedPack).toBeUndefined();
  });
});
