/**
 * useSurfaceConditions — env-pack offline fallback tests.
 *
 * When the device is offline and no live query data is available, the hook
 * must serve wave height/direction from the cached env pack's marine
 * conditions (with wind/current from the manual fallback values).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── idb-keyval mock ───────────────────────────────────────────────────────────
vi.mock("idb-keyval", () => ({
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
}));

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    getGetSurfaceConditionsQueryKey: (...args: unknown[]) => ["surface-conditions", ...args],
  }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

const DRIFT_STORE_STATE = {
  manualWindSpeedKnots: 7,
  manualWindDegrees: 90,
  manualTidalSpeedKnots: 0.5,
  manualTidalDegrees: 180,
  driftPlannerActive: false,
  driftHour: 0,
};

vi.mock("@/lib/driftStore", () => ({
  useDriftStore: (sel: (s: typeof DRIFT_STORE_STATE) => unknown) =>
    sel(DRIFT_STORE_STATE),
}));

import { useOfflineStore } from "@/lib/offlineStore";
import { useEnvOfflineStore } from "@/lib/envOfflineStore";
import type { EnvPack } from "@/lib/envPackTypes";
import { useSurfaceConditions } from "@/hooks/useSurfaceConditions";

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
      waveHeightM: [1.7],
      waveDirectionDeg: [220],
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

describe("useSurfaceConditions env-pack offline fallback", () => {
  beforeEach(() => {
    resetStores();
  });

  it("serves wave data from the env pack when offline", () => {
    const pack = makePack();
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: pack });
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.isCachedPack).toBe(true);
    expect(result.current.snapshot).not.toBeNull();
    expect(result.current.snapshot?.waveHeightM).toBe(1.7);
    expect(result.current.snapshot?.waveDirectionDeg).toBe(220);
    // Wind/current fall back to the manual drift-store values.
    expect(result.current.snapshot?.windSpeedKnots).toBe(7);
    expect(result.current.snapshot?.tidalSpeedKnots).toBe(0.5);
    expect(result.current.estimated).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(result.current.timestamp).toBe(pack.generatedAt);
  });

  it("does not use the env pack when ONLINE", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: true });
      useEnvOfflineStore.setState({ envPack: makePack() });
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.isCachedPack).toBeUndefined();
  });

  it("does not use an EXPIRED env pack when offline", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({
        envPack: makePack({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      });
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.isCachedPack).toBeUndefined();
  });

  it("does not use the env pack when it has no marine conditions", () => {
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: makePack({ marineConditions: null }) });
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.isCachedPack).toBeUndefined();
  });

  it("picks the marine sample closest to now", () => {
    const nowIso = new Date().toISOString();
    const pack = makePack({
      marineConditions: {
        times: [
          new Date(Date.now() - 48 * 3600_000).toISOString(),
          nowIso,
          new Date(Date.now() + 48 * 3600_000).toISOString(),
        ],
        seaSurfaceTemperatureC: [8, 9.5, 10],
        waveHeightM: [0.2, 2.4, 0.9],
        waveDirectionDeg: [100, 210, 300],
      },
    });
    act(() => {
      useOfflineStore.setState({ isOnline: false });
      useEnvOfflineStore.setState({ envPack: pack });
    });

    const { result } = renderHook(() => useSurfaceConditions());

    expect(result.current.snapshot?.waveHeightM).toBe(2.4);
    expect(result.current.snapshot?.waveDirectionDeg).toBe(210);
  });
});
