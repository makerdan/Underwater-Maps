/**
 * HUD — GPS Follow Mode button visibility, disabled-state, and tooltip tests.
 *
 * Verifies:
 *  1. The Follow Me button is absent when GPS is inactive.
 *  2. The Follow Me button appears (enabled) when GPS is active and in bounds.
 *  3. The Follow Me button appears but is disabled when GPS is active and
 *     the live position is outside the current dataset bounds.
 *  4. The out-of-bounds tooltip text is shown when tooltips are enabled and
 *     the user hovers the disabled Follow Me button.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

// ── Mutable GPS + terrain state for each test ────────────────────────────
interface MockGpsState {
  active: boolean;
  position: { latitude: number; longitude: number; accuracy: number; timestamp: number } | null;
}
interface MockOverviewGrid {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}
interface MockTerrainState {
  overviewGrid: MockOverviewGrid | null;
}

let mockGps: MockGpsState = { active: false, position: null };
let mockTerrain: MockTerrainState = { overviewGrid: null };
/** Toggled per-test; controls whether ViewscreenTooltip renders its Radix wrapper. */
let mockShowUiTooltips = false;

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetDatasets: () => ({ data: [] }),
    getGetDatasetsQueryKey: () => ["datasets"],
  };
});

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
  useGpsStore: (sel: (s: MockGpsState) => unknown) => sel(mockGps),
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: MockTerrainState) => unknown) => sel(mockTerrain),
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (
    sel: (s: {
      showCrosshairGps: boolean;
      showHeading: boolean;
      coordinateFormat: "decimal";
      units: "metric";
      temperatureUnit: "celsius";
      hudOpacity: number;
      largeHudText: boolean;
      highContrastHud: boolean;
      colorBlindSafePalette: boolean;
      smoothTerrainSpikes: boolean;
      showUiTooltips: boolean;
      keyBindings: Record<string, string>;
    }) => unknown,
  ) =>
    sel({
      showCrosshairGps: false,
      showHeading: false,
      coordinateFormat: "decimal",
      units: "metric",
      temperatureUnit: "celsius",
      hudOpacity: 1,
      largeHudText: false,
      highContrastHud: false,
      colorBlindSafePalette: false,
      smoothTerrainSpikes: true,
      showUiTooltips: mockShowUiTooltips,
      keyBindings: {},
    }),
}));

/** A grid that covers 0–10 lat, 0–10 lon. */
const GRID_IN: MockOverviewGrid = { minLat: 0, maxLat: 10, minLon: 0, maxLon: 10 };

/** A GPS position squarely inside GRID_IN. */
const POS_IN = { latitude: 5, longitude: 5, accuracy: 5, timestamp: 0 };

/** A GPS position clearly outside GRID_IN. */
const POS_OUT = { latitude: 50, longitude: 50, accuracy: 5, timestamp: 0 };

/**
 * Render HUD inside a TooltipProvider with delayDuration=0 so Radix
 * tooltips open immediately on hover without needing timer advances.
 */
function renderHUD() {
  return render(<HUD />, {
    wrapper: ({ children }) => (
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    ),
  });
}

describe("HUD — GPS Follow Mode button", () => {
  beforeEach(() => {
    useCameraStore.setState({
      crosshairGps: null,
      lastClickedGps: null,
      cameraLon: null,
      cameraLat: null,
      cameraDepth: null,
      heading: 0,
      speedIndex: 0,
      gpsFollowMode: false,
    });
    mockGps = { active: false, position: null };
    mockTerrain = { overviewGrid: null };
    mockShowUiTooltips = false;
  });

  it("does not render the Follow Me button when GPS is inactive", () => {
    mockGps = { active: false, position: null };
    renderHUD();
    expect(screen.queryByTestId("hud-gps-follow-toggle")).not.toBeInTheDocument();
  });

  it("renders the Follow Me button enabled when GPS is active and position is in bounds", () => {
    mockGps = { active: true, position: POS_IN };
    mockTerrain = { overviewGrid: GRID_IN };
    renderHUD();

    const btn = screen.getByTestId("hud-gps-follow-toggle");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("renders the Follow Me button disabled when GPS is active but position is out of bounds", () => {
    mockGps = { active: true, position: POS_OUT };
    mockTerrain = { overviewGrid: GRID_IN };
    renderHUD();

    const btn = screen.getByTestId("hud-gps-follow-toggle");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("renders the Follow Me button disabled when GPS is active but no overviewGrid is loaded", () => {
    mockGps = { active: true, position: POS_IN };
    mockTerrain = { overviewGrid: null };
    renderHUD();

    const btn = screen.getByTestId("hud-gps-follow-toggle");
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("renders the Follow Me button with aria-pressed=true when follow mode is on", () => {
    mockGps = { active: true, position: POS_IN };
    mockTerrain = { overviewGrid: GRID_IN };
    useCameraStore.setState({ gpsFollowMode: true });
    renderHUD();

    const btn = screen.getByTestId("hud-gps-follow-toggle");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the out-of-bounds tooltip text when GPS is active but outside the dataset", async () => {
    mockShowUiTooltips = true;
    mockGps = { active: true, position: POS_OUT };
    mockTerrain = { overviewGrid: GRID_IN };

    const user = userEvent.setup();
    renderHUD();

    const btn = screen.getByTestId("hud-gps-follow-toggle");
    expect(btn).toBeDisabled();

    // Hover the button — TooltipProvider has delayDuration=0 so it opens immediately.
    await user.hover(btn);

    // Radix renders the tooltip text into a role="tooltip" element.
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "GPS position is outside the current dataset",
      );
    });
  });
});
