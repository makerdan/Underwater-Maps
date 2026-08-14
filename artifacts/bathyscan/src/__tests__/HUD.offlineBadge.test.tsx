/**
 * HUD.offlineBadge.test.tsx
 *
 * Confirms that the HUD renders the offline badge (`data-testid="offline-badge"`)
 * when `isOnline` is false, and that the badge is absent when online.
 *
 * Uses the same mock skeleton as HUD.test.tsx so the heavy Three.js / store
 * dependencies don't pull in real WebGL or network code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// API client mock — no real HTTP, just stubs.
// ---------------------------------------------------------------------------
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
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({ useGetDatasets: () => ({ data: [] }) }),
);

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/hooks/useSurfaceTemperature", () => ({
  useSurfaceTemperature: () => ({ anchor: null, loading: false, error: false }),
}));

vi.mock("@/hooks/useTemperatureProfile", () => ({
  useTemperatureProfile: () => ({ profile: null, loading: false, error: false }),
}));

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (sel: (s: { active: boolean; position: null }) => unknown) =>
    sel({ active: false, position: null }),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { overviewGrid: null; visibleDatasets: []; selectedIds: [] }) => unknown) =>
    sel({ overviewGrid: null, visibleDatasets: [], selectedIds: [] }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = {
    showCrosshairGps: true,
    showCameraPosition: true,
    showHeading: false,
    coordinateFormat: "decimal" as const,
    depthUnit: "metres" as const,
    units: "metric" as const,
    hudOpacity: 1,
    globalFontSize: "medium" as const,
    highContrastHud: false,
    colorBlindSafePalette: false,
    smoothTerrainSpikes: true,
    keyBindings: {},
    temperatureUnit: "celsius" as const,
    manualConditionsByDataset: {},
    selectManualConditionsActiveSource: {},
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

// ---------------------------------------------------------------------------
// offlineStore — controllable via a ref so individual tests can toggle it.
// ---------------------------------------------------------------------------

/** Mutable cell — test cases write to it before rendering. */
const offlineState = { isOnline: true };

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel(offlineState),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HUD offline badge", () => {
  beforeEach(() => {
    // Reset to a neutral camera state before each test.
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraPosition: { known: false },
      cameraDepth: null,
      heading: 0,
      speedIndex: 0,
    });
    // Default: online.
    offlineState.isOnline = true;
  });

  it("does NOT render the offline badge when isOnline is true", () => {
    offlineState.isOnline = true;
    render(<HUD />);
    expect(screen.queryByTestId("offline-badge")).not.toBeInTheDocument();
  });

  it("renders the offline badge when isOnline is false", () => {
    offlineState.isOnline = false;
    render(<HUD />);
    expect(screen.getByTestId("offline-badge")).toBeInTheDocument();
  });

  it("offline badge contains the OFFLINE indicator text", () => {
    offlineState.isOnline = false;
    render(<HUD />);
    const badge = screen.getByTestId("offline-badge");
    expect(badge.textContent).toMatch(/OFFLINE/i);
  });

  it("hides the badge again when isOnline transitions back to true", () => {
    offlineState.isOnline = false;
    const { rerender } = render(<HUD />);
    expect(screen.getByTestId("offline-badge")).toBeInTheDocument();

    // Simulate device coming back online.
    act(() => {
      offlineState.isOnline = true;
    });
    rerender(<HUD />);
    expect(screen.queryByTestId("offline-badge")).not.toBeInTheDocument();
  });
});
