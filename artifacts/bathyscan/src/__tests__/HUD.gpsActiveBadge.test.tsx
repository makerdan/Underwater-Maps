/**
 * HUD.gpsActiveBadge.test.tsx
 *
 * The GPS watch intentionally keeps running when the user leaves the Live tab
 * (see liveMode.ts). The HUD must surface a "GPS ACTIVE" badge
 * (`data-testid="hud-gps-active-badge"`) whenever the watch is active
 * (watchId non-null) AND the sidebar is NOT on the Live tab, so the user
 * knows their GPS hardware is still polling (battery drain on mobile).
 *
 * Uses the same mock skeleton as HUD.offlineBadge.test.tsx, plus a mocked
 * uiStore (mutable sidebarMode) and gpsStore (mutable watchId).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

// Mutable GPS state — tests set watchId before rendering.
interface MockGpsState {
  active: boolean;
  position: null;
  watchId: number | null;
}
const gpsState: MockGpsState = { active: false, position: null, watchId: null };

vi.mock("@/lib/gpsStore", () => ({
  useGpsStore: (sel: (s: MockGpsState) => unknown) => sel(gpsState),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: { overviewGrid: null; visibleDatasets: []; selectedIds: [] }) => unknown) =>
    sel({ overviewGrid: null, visibleDatasets: [], selectedIds: [] }),
}));

// Mutable uiStore mock — tests flip sidebarMode. The real uiStore's
// auto-mirror subscription and liveMode wiring are deliberately bypassed here
// so switching sidebarMode in a test cannot trigger enter/exitLiveMode.
type MockSidebarMode = "explore" | "plan" | "analyze" | "live";
interface MockUiState {
  whatsHereOpen: boolean;
  setWhatsHereOpen: () => void;
  sidebarMode: MockSidebarMode;
}
const uiState: MockUiState = {
  whatsHereOpen: false,
  setWhatsHereOpen: () => {},
  sidebarMode: "explore",
};

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: MockUiState) => unknown) => sel(uiState),
    {
      getState: () => uiState,
      setState: () => {},
      subscribe: () => () => {},
    },
  ),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = {
    showCrosshairGps: false,
    showHeading: false,
    coordinateFormat: "decimal" as const,
    units: "metric" as const,
    hudOpacity: 1,
    globalFontSize: "medium" as const,
    highContrastHud: false,
    colorBlindSafePalette: false,
    smoothTerrainSpikes: true,
    keyBindings: {},
    temperatureUnit: "celsius" as const,
    showUiTooltips: false,
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

// Mutable offline state so the stacking test can flip it.
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

const BADGE = "hud-gps-active-badge";

describe("HUD GPS-active-outside-Live badge", () => {
  beforeEach(() => {
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraPosition: { known: false },
      cameraDepth: null,
      heading: 0,
      speedIndex: 0,
      gpsFollowState: "off",
    });
    gpsState.active = false;
    gpsState.position = null;
    gpsState.watchId = null;
    uiState.sidebarMode = "explore";
    offlineState.isOnline = true;
  });

  it("renders the badge when the GPS watch is active and sidebar is NOT on Live", () => {
    gpsState.watchId = 42;
    uiState.sidebarMode = "explore";
    render(<HUD />);
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
    expect(screen.getByTestId(BADGE).textContent).toMatch(/GPS ACTIVE/i);
  });

  it("renders the badge on other non-Live tabs too (plan)", () => {
    gpsState.watchId = 7;
    uiState.sidebarMode = "plan";
    render(<HUD />);
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
  });

  it("does NOT render the badge when the sidebar is on the Live tab", () => {
    gpsState.watchId = 42;
    uiState.sidebarMode = "live";
    render(<HUD />);
    expect(screen.queryByTestId(BADGE)).not.toBeInTheDocument();
  });

  it("does NOT render the badge when the GPS watch is stopped (watchId null)", () => {
    gpsState.watchId = null;
    uiState.sidebarMode = "explore";
    render(<HUD />);
    expect(screen.queryByTestId(BADGE)).not.toBeInTheDocument();
  });

  it("disappears when the watch stops", () => {
    gpsState.watchId = 42;
    const { rerender } = render(<HUD />);
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();

    gpsState.watchId = null;
    rerender(<HUD />);
    expect(screen.queryByTestId(BADGE)).not.toBeInTheDocument();
  });

  it("coexists with the offline badge (stacks below it) when offline", () => {
    gpsState.watchId = 42;
    offlineState.isOnline = false;
    render(<HUD />);
    expect(screen.getByTestId("offline-badge")).toBeInTheDocument();
    expect(screen.getByTestId(BADGE)).toBeInTheDocument();
  });
});
