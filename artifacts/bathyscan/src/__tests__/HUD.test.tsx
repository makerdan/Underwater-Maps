import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HUD } from "@/components/HUD";
import { useCameraStore } from "@/lib/cameraStore";

vi.mock("@/lib/context", () => ({
  SPEEDS: [0.05, 0.15, 0.5, 1.5, 5.0],
  useAppState: () => ({
    realisticMode: false,
    boatSpeedMph: 5,
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
      hudOpacity: number;
    }) => unknown,
  ) =>
    sel({
      showCrosshairGps: true,
      showCameraPosition: true,
      showSpeedIndicator: true,
      showHeading: true,
      coordinateFormat: "decimal",
      depthUnit: "metres",
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

  it("shows FLY badge when mode is fly", () => {
    useCameraStore.setState({ mode: "fly" });
    render(<HUD />);
    expect(screen.getByText(/● FLY/)).toBeInTheDocument();
    expect(screen.queryByText(/◎ ORBIT/)).not.toBeInTheDocument();
  });

  it("shows ORBIT badge when mode is orbit", () => {
    useCameraStore.setState({ mode: "orbit" });
    render(<HUD />);
    expect(screen.getByText(/◎ ORBIT/)).toBeInTheDocument();
    expect(screen.queryByText(/● FLY/)).not.toBeInTheDocument();
  });

  it("renders SpeedDots with the correct filled count for speedIndex", () => {
    useCameraStore.setState({ speedIndex: 2 });
    const { container } = render(<HUD />);
    // 5 total speeds; index 2 → 3 filled (indices 0,1,2)
    const filled = container.querySelectorAll("span");
    const dots = Array.from(filled)
      .map((s) => s.textContent ?? "")
      .filter((t) => t === "●" || t === "○");
    const filledCount = dots.filter((t) => t === "●").length;
    const emptyCount = dots.filter((t) => t === "○").length;
    expect(filledCount).toBe(3);
    expect(emptyCount).toBe(2);
  });

  it("updates speed dots when speedIndex changes", () => {
    useCameraStore.setState({ speedIndex: 0 });
    const { container, rerender } = render(<HUD />);
    let dots = Array.from(container.querySelectorAll("span"))
      .map((s) => s.textContent ?? "")
      .filter((t) => t === "●" || t === "○");
    expect(dots.filter((t) => t === "●").length).toBe(1);

    useCameraStore.setState({ speedIndex: 4 });
    rerender(<HUD />);
    dots = Array.from(container.querySelectorAll("span"))
      .map((s) => s.textContent ?? "")
      .filter((t) => t === "●" || t === "○");
    expect(dots.filter((t) => t === "●").length).toBe(5);
    expect(dots.filter((t) => t === "○").length).toBe(0);
  });

  it("renders the heading value", () => {
    useCameraStore.setState({ heading: 87 });
    render(<HUD />);
    expect(screen.getByText("087°")).toBeInTheDocument();
  });
});
