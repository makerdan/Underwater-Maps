/**
 * CameraCoordsReadout — the LON/LAT panel that lives in the left side
 * pane and used to be labelled "CAMERA POSITION". Task #407 renamed it
 * to "YOUR CURRENT COORDINATES" and added an explanatory tooltip on
 * the header. The block must still respect the `showCameraPosition`
 * settings key (unchanged) and the side-pane collapse store.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CameraCoordsReadout } from "@/components/CameraCoordsReadout";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { useCameraStore } from "@/lib/cameraStore";

function resetStores() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  useCameraStore.setState({
    crosshairGps: null,
    lastClickedGps: null,
    cameraPosition: { known: true, lon: -122.5, lat: 47.6 },
    cameraDepth: null,
    heading: 0,
    speedIndex: 0,
  });
}

describe("CameraCoordsReadout", () => {
  beforeEach(() => resetStores());

  it("renders the new 'YOUR CURRENT COORDINATES' header (not 'CAMERA POSITION')", () => {
    render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(screen.getByText("YOUR CURRENT COORDINATES")).toBeInTheDocument();
    expect(screen.queryByText("CAMERA POSITION")).not.toBeInTheDocument();
  });

  it("wraps the header in a ViewscreenTooltip whose label explains the readout", async () => {
    useSettingsStore.getState().setShowUiTooltips(true);
    render(
      <TooltipProvider delayDuration={0}>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    const headerBtn = screen.getByRole("button", { name: /YOUR CURRENT COORDINATES/ });
    expect(headerBtn.getAttribute("data-state")).not.toBeNull();
    fireEvent.focus(headerBtn);
    fireEvent.pointerEnter(headerBtn);
    await waitFor(() => {
      expect(
        screen.getAllByText(/Longitude and latitude of your viewpoint in the 3D scene/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it("does not render when showCameraPosition is OFF", () => {
    useSettingsStore.getState().setShowCameraPosition(false);
    render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(screen.queryByText("YOUR CURRENT COORDINATES")).not.toBeInTheDocument();
  });

  it("shows LON and LAT values when expanded", () => {
    render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(screen.getByText(/LON/)).toBeInTheDocument();
    expect(screen.getByText(/LAT/)).toBeInTheDocument();
    expect(screen.getByText("-122.5000")).toBeInTheDocument();
    expect(screen.getByText("47.6000")).toBeInTheDocument();
  });

  it("shows SURFACE label when cameraDepth is null (camera above water)", () => {
    useCameraStore.setState({ cameraDepth: null });
    render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("camera-depth-surface")).toBeInTheDocument();
    expect(screen.getByTestId("camera-depth-surface").textContent).toBe("SURFACE");
  });

  it("switches cleanly to SURFACE on a rapid underwater→surface transition (no stale numeric flash)", () => {
    const { setCameraGeo } = useCameraStore.getState();
    act(() => {
      setCameraGeo({ lon: -122.5, lat: 47.6, depth: 42, heading: 0, altitude: -42 });
    });
    const { container } = render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(container.textContent ?? "").toMatch(/42/);
    expect(screen.queryByTestId("camera-depth-surface")).not.toBeInTheDocument();

    // Rapid frame-boundary updates: 42 m → 3 m → surfaced (null) in
    // consecutive store commits. After the null commit the readout must
    // show SURFACE with no numeric depth remaining anywhere in the panel.
    act(() => {
      setCameraGeo({ lon: -122.5, lat: 47.6, depth: 3, heading: 0, altitude: -3 });
      setCameraGeo({ lon: -122.5, lat: 47.6, depth: null, heading: 0, altitude: 2 });
    });
    expect(screen.getByTestId("camera-depth-surface").textContent).toBe("SURFACE");
    const depRow = screen.getByText(/DEP/).parentElement;
    expect(depRow?.textContent).toBe("DEP SURFACE");
  });

  it("shows formatted depth when cameraDepth is non-null (camera underwater)", () => {
    useCameraStore.setState({ cameraDepth: 42 });
    render(
      <TooltipProvider>
        <CameraCoordsReadout />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId("camera-depth-surface")).not.toBeInTheDocument();
    expect(screen.getByText(/DEP/)).toBeInTheDocument();
  });
});
