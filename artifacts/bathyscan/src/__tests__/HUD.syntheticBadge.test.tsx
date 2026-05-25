import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TerrainData } from "@workspace/api-client-react";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

let mockTerrain: TerrainData | null = null;

vi.mock("@/hooks/useSurfaceTemperature", () => ({
  useSurfaceTemperature: () => ({ anchor: null, loading: false, error: false }),
}));

vi.mock("@/lib/context", () => ({
  SPEEDS: [0.05, 0.15, 0.5, 1.5, 5.0],
  useAppState: () => ({
    realisticMode: false,
    boatSpeedMph: 5,
    terrain: mockTerrain,
  }),
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
  useSettingsStore: (
    sel: (s: {
      showCrosshairGps: boolean;
      showCameraPosition: boolean;
      showSpeedIndicator: boolean;
      showHeading: boolean;
      coordinateFormat: "decimal";
      depthUnit: "metres";
      units: "metric";
      hudOpacity: number;
      largeHudText: boolean;
      highContrastHud: boolean;
      colorBlindSafePalette: boolean;
    }) => unknown,
  ) =>
    sel({
      showCrosshairGps: true,
      showCameraPosition: true,
      showSpeedIndicator: true,
      showHeading: true,
      coordinateFormat: "decimal",
      depthUnit: "metres",
      units: "metric",
      hudOpacity: 1,
      largeHudText: false,
      highContrastHud: false,
      colorBlindSafePalette: false,
    }),
}));

function makeTerrain(synthetic: boolean): TerrainData {
  return {
    datasetId: "gebco-test",
    bounds: { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 },
    grid: {
      width: 2,
      height: 2,
      depths: [0, -1, -1, -2],
    },
    synthetic,
  } as unknown as TerrainData;
}

describe("HUD simulated-data badge", () => {
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
    mockTerrain = null;
  });

  it("shows the SIMULATED DATA badge when terrain.synthetic is true", () => {
    mockTerrain = makeTerrain(true);
    render(<HUD />);
    const badge = screen.getByTestId("synthetic-data-badge");
    expect(badge).toBeVisible();
    expect(badge).toHaveTextContent(/SIMULATED DATA/);
  });

  it("hides the SIMULATED DATA badge when terrain.synthetic is false", () => {
    mockTerrain = makeTerrain(false);
    render(<HUD />);
    expect(screen.queryByTestId("synthetic-data-badge")).not.toBeInTheDocument();
  });

  it("hides the SIMULATED DATA badge when terrain is null", () => {
    mockTerrain = null;
    render(<HUD />);
    expect(screen.queryByTestId("synthetic-data-badge")).not.toBeInTheDocument();
  });
});
