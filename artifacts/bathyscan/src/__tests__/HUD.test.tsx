import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({ data: [] }),
  getGetDatasetsQueryKey: () => ["datasets"],
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
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

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (
    sel: (s: {
      showCrosshairGps: boolean;
      showCameraPosition: boolean;
      showHeading: boolean;
      coordinateFormat: "decimal";
      depthUnit: "metres";
      units: "metric";
      hudOpacity: number;
    }) => unknown,
  ) =>
    sel({
      showCrosshairGps: true,
      showCameraPosition: true,
      showHeading: true,
      coordinateFormat: "decimal",
      depthUnit: "metres",
      units: "metric",
      hudOpacity: 1,
    }),
}));

describe("HUD", () => {
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
  });

  it("no longer renders the FLY / ORBIT mode badge", () => {
    useCameraStore.setState({ mode: "fly" });
    render(<HUD />);
    expect(screen.queryByText(/● FLY/)).not.toBeInTheDocument();
    expect(screen.queryByText(/◎ ORBIT/)).not.toBeInTheDocument();
  });

  it("no longer renders the SPD speed indicator panel", () => {
    useCameraStore.setState({ speedIndex: 2 });
    const { container } = render(<HUD />);
    expect(container.textContent ?? "").not.toMatch(/\bSPD\b/);
    const dots = Array.from(container.querySelectorAll("span"))
      .map((s) => s.textContent ?? "")
      .filter((t) => t === "●" || t === "○");
    expect(dots.length).toBe(0);
  });

  it("renders the heading value", () => {
    useCameraStore.setState({ heading: 87 });
    render(<HUD />);
    expect(screen.getByText("087°")).toBeInTheDocument();
  });
});
