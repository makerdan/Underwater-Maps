/**
 * HudOverviewToggle.test.tsx — covers the HUD button that opens / closes
 * the 2D Overview Map (Task #349). The button must mirror `overviewOpen`
 * from the UI store so the `O` keyboard shortcut and the in-map close
 * button stay in sync visually.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";
import { useUiStore } from "@/lib/uiStore";

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({ data: [] }),
  getGetDatasetsQueryKey: () => ["datasets"],
}));

vi.mock("@/lib/context", () => ({
  SPEEDS: [0.05, 0.15, 0.5, 1.5, 5.0],
  // The overlay-toggle cluster (which hosts the new overview button) is
  // only rendered when `terrain` is present, so provide a stub here.
  useAppState: () => ({
    realisticMode: false,
    boatSpeedMph: 5,
    terrain: { datasetId: "test", minLon: 0, maxLon: 1, minLat: 0, maxLat: 1, width: 2, height: 2, depths: [0, 0, 0, 0], minDepth: 0, maxDepth: 0, resolution: 2 },
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
vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      showCrosshairGps: true,
      showCameraPosition: true,
      showSpeedIndicator: true,
      showHeading: true,
      coordinateFormat: "decimal",
      depthUnit: "metres",
      units: "metric",
      hudOpacity: 1,
    }),
}));

describe("HUD overview toggle", () => {
  beforeEach(() => {
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraLon: null,
      cameraLat: null,
      cameraDepth: null,
      heading: 0,
      mode: "fly",
      speedIndex: 0,
    });
    useUiStore.setState({ overviewOpen: false });
  });

  it("renders the overview HUD toggle with aria-pressed=false when closed", () => {
    render(<HUD />);
    const btn = screen.getByTestId("hud-toggle-overview");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the overview map when clicked", () => {
    render(<HUD />);
    fireEvent.click(screen.getByTestId("hud-toggle-overview"));
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });

  it("reflects external state changes via aria-pressed", () => {
    const { rerender } = render(<HUD />);
    expect(screen.getByTestId("hud-toggle-overview")).toHaveAttribute("aria-pressed", "false");
    useUiStore.setState({ overviewOpen: true });
    rerender(<HUD />);
    expect(screen.getByTestId("hud-toggle-overview")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles back to closed on a second click", () => {
    useUiStore.setState({ overviewOpen: true });
    render(<HUD />);
    fireEvent.click(screen.getByTestId("hud-toggle-overview"));
    expect(useUiStore.getState().overviewOpen).toBe(false);
  });
});
