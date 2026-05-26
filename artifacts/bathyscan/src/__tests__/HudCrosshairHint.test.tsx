/**
 * HUD crosshair shortcut hint: ensure the badge next to the crosshair
 * coordinates reflects the user-configured `crosshairMenuKey` from the
 * settings store, not a hard-coded "Q".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { renderWithProviders as render } from "./setup";

// HUD computes `IS_TOUCH_DEVICE` once at module load — force the desktop
// (non-touch) branch via a hoisted block so the override runs *before*
// the HUD import below, so the keyboard hint badge renders instead of
// the touch-only "⋯ ACTIONS" button.
vi.hoisted(() => {
  if (typeof window !== "undefined" && "ontouchstart" in window) {
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  }
  if (typeof navigator !== "undefined") {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 0,
    });
  }
});

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({ data: [] }),
  getGetDatasetsQueryKey: () => ["datasets"],
}));

vi.mock("@/lib/context", () => ({
  SPEEDS: [0.05, 0.15, 0.5, 1.5, 5.0],
  useAppState: () => ({
    realisticMode: false,
    boatSpeedMph: 5,
    terrain: null,
  }),
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
  useTerrainStore: (sel: (s: { overviewGrid: null }) => unknown) =>
    sel({ overviewGrid: null }),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

// Note: we deliberately do NOT mock @/lib/settingsStore here so the HUD
// reads the real persisted store and re-renders when crosshairMenuKey
// changes.

import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
    showCrosshairGps: true,
  });
  useCameraStore.setState({
    crosshairGps: { lon: -122.4, lat: 47.6, depth: 50 },
    lastClickedGps: null,
    cameraLon: null,
    cameraLat: null,
    cameraDepth: null,
    heading: 0,
    speedIndex: 0,
  });
});

describe("HUD crosshair shortcut hint", () => {
  it("renders the default Q binding label", () => {
    render(<HUD />);
    const hint = screen.getByTestId("hud-crosshair-q-hint");
    expect(hint).toHaveTextContent("Q · ACTIONS");
    expect(hint.getAttribute("title")).toContain("Press Q");
  });

  it("updates the visible label and tooltip when the binding changes", () => {
    const { rerender } = render(<HUD />);
    act(() => {
      useSettingsStore.getState().setCrosshairMenuKey("KeyT");
    });
    rerender(<HUD />);

    const hint = screen.getByTestId("hud-crosshair-q-hint");
    expect(hint).toHaveTextContent("T · ACTIONS");
    expect(hint.getAttribute("title")).toContain("Press T");
  });

  it("renders a friendly label for non-letter codes like Slash", () => {
    useSettingsStore.getState().setCrosshairMenuKey("Slash");
    render(<HUD />);
    const hint = screen.getByTestId("hud-crosshair-q-hint");
    expect(hint).toHaveTextContent("/ · ACTIONS");
  });
});
