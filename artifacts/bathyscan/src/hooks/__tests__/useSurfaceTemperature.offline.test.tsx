/**
 * useSurfaceTemperature — offline fallback branch tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

// ── idb-keyval mock ───────────────────────────────────────────────────────────
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

// ── React Query mock ──────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useGetWaterTemperature: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  getGetWaterTemperatureQueryKey: vi.fn().mockReturnValue(["water-temperature"]),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { useSurfaceTemperature } from "../useSurfaceTemperature";
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
    marineConditions: {
      times: [new Date().toISOString()],
      seaSurfaceTemperatureC: [9.5],
      waveHeightM: [0.5],
      waveDirectionDeg: [200],
    },
    temperatureProfile: null,
    warnings: [],
    ...overrides,
  };
}

function resetStores() {
  useOfflineStore.setState({ isOnline: true });
  useEnvOfflineStore.setState({ envPack: null, isDownloading: false, downloadError: null });
}

describe("useSurfaceTemperature offline fallback", () => {
  beforeEach(() => {
    resetStores();
  });

  it("returns SST from env pack when offline and pack has marine conditions", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(
      () => useSurfaceTemperature(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.anchor).not.toBeNull();
    expect(result.current.anchor?.sstCelsius).toBe(9.5);
    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("returns null anchor when offline with no pack", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: null });
    });

    const { result } = renderHook(
      () => useSurfaceTemperature(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.anchor).toBeNull();
  });

  it("returns null anchor when offline, pack has no marine conditions", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack({ marineConditions: null }) });
    });

    const { result } = renderHook(
      () => useSurfaceTemperature(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    expect(result.current.anchor).toBeNull();
    expect(result.current.isCachedPack).toBe(true);
  });

  it("does NOT use pack data when online (normal path)", () => {
    act(() => useOfflineStore.setState({ isOnline: true }));

    const { result } = renderHook(
      () => useSurfaceTemperature(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    // React Query mock returns undefined data → null anchor
    expect(result.current.anchor).toBeNull();
    expect(result.current.isCachedPack).toBeUndefined();
  });

  it("returns null when offline and pack is expired", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(
      () => useSurfaceTemperature(57.05, -135.33),
      { wrapper: makeWrapper() },
    );

    // Expired pack — should not serve cached data
    expect(result.current.isCachedPack).toBeUndefined();
  });
});
