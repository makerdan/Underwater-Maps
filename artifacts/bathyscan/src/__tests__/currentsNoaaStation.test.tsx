/**
 * Verifies the NOAA-currents-station wiring added for Task #167:
 *   - useCurrentsStore.noaaAmbient is only set when the /api/tidal response
 *     carries currentsSource === "noaa" (real CO-OPS station predictions).
 *   - When it is set, it includes the station id + name so the CurrentsPanel
 *     can surface them.
 *   - The CurrentsPanel renders the station id and name to the user when
 *     source = NOAA and an ambient is available, and shows a fallback hint
 *     when no station is in range.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { useCurrentsStore } from "@/lib/currentsStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { CurrentsPanel } from "@/components/CurrentsPanel";

function resetStores() {
  act(() => {
    useCurrentsStore.setState({ field: null, noaaAmbient: null });
    useSettingsStore.setState({
      currentsEnabled: true,
      currentsSource: "noaa",
      currentsManualDirectionDeg: 0,
      currentsManualSpeedKt: 0.5,
      currentsTidePhase: 0.5,
      currentsAutoAdvance: false,
      currentsShowParticles: true,
      currentsShowArrows: true,
      currentsShowStreamlines: false,
    });
  });
}

describe("CurrentsPanel — NOAA station readout (Task #167)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("shows station name + id when an in-range NOAA station is available", () => {
    act(() => {
      useCurrentsStore.getState().setNoaaAmbient({
        directionDeg: 132,
        speedKt: 0.74,
        stationId: "PCT3026",
        stationName: "Snow Passage",
      });
    });
    render(<CurrentsPanel />);
    const station = screen.getByTestId("currents-noaa-station");
    expect(station.textContent).toContain("Snow Passage");
    expect(station.textContent).toContain("PCT3026");
    expect(
      screen.getByTestId("currents-noaa-readout").textContent,
    ).toContain("132° @ 0.74 kt");
  });

  it("falls back to a tide-derived-estimate hint when no station is in range", () => {
    // noaaAmbient stays null — simulates the App.tsx effect refusing to set
    // it when the server responded with currentsSource === "estimated".
    render(<CurrentsPanel />);
    expect(
      screen.getByTestId("currents-noaa-readout").textContent,
    ).toContain("No NOAA currents station in range");
    expect(screen.queryByTestId("currents-noaa-station")).toBeNull();
  });

  it("renders without a station block when the ambient lacks station info", () => {
    // Older callers (or a server response that omits currentsStation) should
    // still render the speed/direction line but skip the station row.
    act(() => {
      useCurrentsStore
        .getState()
        .setNoaaAmbient({ directionDeg: 90, speedKt: 0.3 });
    });
    render(<CurrentsPanel />);
    expect(
      screen.getByTestId("currents-noaa-readout").textContent,
    ).toContain("90° @ 0.30 kt");
    expect(screen.queryByTestId("currents-noaa-station")).toBeNull();
  });
});
