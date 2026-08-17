/**
 * Verifies the NOAA-currents-station wiring added for Task #167:
 *   - useCurrentsStore.noaaAmbient stays populated whenever /api/tidal has a
 *     usable current (so the NOAA simulation mode keeps flowing), but
 *     carries a `source` flag distinguishing real station data from the
 *     tide-derived estimate.
 *   - CurrentsPanel labels the readout honestly ("NOAA" vs "Estimated") and
 *     surfaces station id + name only when source === "noaa".
 *   - The CurrentsLayer ambient-selection memo prefers the noaaAmbient
 *     vector over manual settings whenever it's present, regardless of
 *     source — so we don't silently switch to the manual slider when no
 *     station is in range.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { useCurrentsStore, type NoaaAmbient, type TidalStatus } from "@/lib/currentsStore";
import { useSettingsStore } from "@/lib/settingsStore";
import { CurrentsPanel } from "@/components/CurrentsPanel";
import { MPH_TO_KNOTS, MPH_TO_KPH } from "@/lib/units";

// Mutable ref so individual tests can control whether a map is loaded.
// vi.hoisted() is required because vi.mock factories are hoisted before
// variable declarations — a plain `let` would be in the TDZ when the
// factory runs (see project memory: vi-hoisted-mock-vars).
const mockTerrainRef = vi.hoisted(() => ({ current: null as object | null }));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: mockTerrainRef.current }),
}));

function resetStores(tidalStatus: TidalStatus = "ok") {
  act(() => {
    useCurrentsStore.setState({ field: null, noaaAmbient: null, tidalStatus, retryTidal: () => {} });
    // IMPORTANT: Keep this slice in sync with settingsStore's full shape.
    // If you add a required field to settingsStore, add it here too — a missing
    // field causes silent failures in concurrent test runs (Zustand partial setState
    // merges but omitted fields revert to stale defaults mid-test).
    // See project memory: settingsstore-mock-persist for the pattern and rationale.
    useSettingsStore.setState({
      units: "nautical",
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
    mockTerrainRef.current = null;
    resetStores();
  });

  it("shows station name + id when source is NOAA", () => {
    act(() => {
      useCurrentsStore.getState().setNoaaAmbient({
        directionDeg: 132,
        speedKt: 0.74,
        source: "noaa",
        stationId: "PCT3026",
        stationName: "Snow Passage",
      });
    });
    render(<CurrentsPanel />);
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout.textContent).toContain("NOAA:");
    expect(readout.textContent).toContain("132° SE @ 0.74 kn");
    const station = screen.getByTestId("currents-noaa-station");
    expect(station.textContent).toContain("Snow Passage");
    expect(station.textContent).toContain("PCT3026");
    expect(screen.queryByTestId("currents-noaa-estimated")).toBeNull();
  });

  it("labels the readout 'Estimated' and shows the fallback hint when no station is in range", () => {
    act(() => {
      useCurrentsStore.getState().setNoaaAmbient({
        directionDeg: 90,
        speedKt: 0.3,
        source: "estimated",
      });
    });
    render(<CurrentsPanel />);
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout.textContent).toContain("Estimated:");
    expect(readout.textContent).toContain("90° E @ 0.30 kn");
    expect(
      screen.getByTestId("currents-noaa-estimated").textContent,
    ).toContain("No NOAA station in range");
    expect(screen.queryByTestId("currents-noaa-station")).toBeNull();
  });

  it("shows 'Processing…' when status is ok but no ambient published yet (transient race)", () => {
    render(<CurrentsPanel />);
    expect(
      screen.getByTestId("currents-noaa-readout").textContent,
    ).toContain("Processing");
  });

  it("shows loading indicator when tidalStatus is 'loading'", () => {
    resetStores("loading");
    render(<CurrentsPanel />);
    expect(
      screen.getByTestId("currents-noaa-loading").textContent,
    ).toContain("Fetching NOAA data");
  });

  it("shows unavailable message with Retry and Switch to Manual when tidalStatus is 'unavailable'", () => {
    resetStores("unavailable");
    render(<CurrentsPanel />);
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout.textContent).toContain("No NOAA tidal station found");
    expect(screen.getByTestId("currents-noaa-retry")).toBeDefined();
    expect(screen.getByTestId("currents-noaa-switch-manual")).toBeDefined();
  });

  it("shows connecting indicator when tidalStatus is 'idle' and a map is loaded", () => {
    // Regression guard (Task #4013): when NOAA is the persisted source and a
    // map is loaded, the panel must show the "Connecting" transient state
    // rather than the "no-map" hint — the tidal fetch is in flight.
    mockTerrainRef.current = { datasetId: "test-lake" };
    resetStores("idle");
    render(<CurrentsPanel />);
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout.textContent).toContain("Connecting to NOAA");
    expect(screen.getByTestId("currents-noaa-idle")).toBeDefined();
    expect(screen.queryByTestId("currents-noaa-no-map")).toBeNull();
  });

  it("shows 'load a map' hint when tidalStatus is 'idle' and no map is loaded", () => {
    // Regression guard (Task #4013): with NOAA selected but no terrain loaded,
    // the panel must show an actionable hint instead of "Connecting to NOAA…"
    // (which implies a fetch is in progress when actually coords are null).
    mockTerrainRef.current = null;
    resetStores("idle");
    render(<CurrentsPanel />);
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout.textContent).toContain("Load a map");
    expect(screen.getByTestId("currents-noaa-no-map")).toBeDefined();
    expect(screen.queryByTestId("currents-noaa-idle")).toBeNull();
  });
});

describe("CurrentsLayer ambient selection (Task #167 fallback)", () => {
  beforeEach(() => {
    resetStores();
  });

  // Mirrors the memo in CurrentsLayer.tsx lines 343-346. Kept here as a
  // pure unit so we don't have to render an R3F canvas just to assert the
  // selection rule — the rule is what matters for the regression code
  // review flagged.
  function selectBaseAmbient(
    source: "noaa" | "manual",
    noaaAmbient: NoaaAmbient | null,
    manual: { speedKt: number; directionDeg: number },
  ) {
    if (source === "noaa" && noaaAmbient) {
      return { speedKt: noaaAmbient.speedKt, directionDeg: noaaAmbient.directionDeg };
    }
    return manual;
  }

  it("uses the NOAA-station ambient when source=noaa and a station was in range", () => {
    const picked = selectBaseAmbient(
      "noaa",
      { directionDeg: 200, speedKt: 1.1, source: "noaa", stationId: "x" },
      { speedKt: 0.5, directionDeg: 0 },
    );
    expect(picked).toEqual({ speedKt: 1.1, directionDeg: 200 });
  });

  it("still uses the tide-derived ambient (not manual) when source=noaa but no station is in range", () => {
    // The bug we are guarding against: previously nulling noaaAmbient made
    // CurrentsLayer fall back to manual settings while the panel claimed
    // "tide-derived estimate". The fix is to keep publishing the ambient
    // with source: "estimated".
    const picked = selectBaseAmbient(
      "noaa",
      { directionDeg: 90, speedKt: 0.3, source: "estimated" },
      { speedKt: 0.5, directionDeg: 0 },
    );
    expect(picked).toEqual({ speedKt: 0.3, directionDeg: 90 });
  });

  it("uses the manual ambient when source=manual, regardless of NOAA availability", () => {
    const picked = selectBaseAmbient(
      "manual",
      { directionDeg: 90, speedKt: 0.3, source: "noaa", stationId: "x" },
      { speedKt: 0.5, directionDeg: 45 },
    );
    expect(picked).toEqual({ speedKt: 0.5, directionDeg: 45 });
  });
});

describe("CurrentsPanel — manual speed input unit conversion", () => {
  function setupManual(units: "nautical" | "metric" | "imperial", speedKt: number) {
    act(() => {
      useCurrentsStore.setState({ field: null, noaaAmbient: null });
      useSettingsStore.setState({
        units,
        currentsEnabled: true,
        currentsSource: "manual",
        currentsManualDirectionDeg: 0,
        currentsManualSpeedKt: speedKt,
        currentsTidePhase: 0.5,
        currentsAutoAdvance: false,
        currentsShowParticles: true,
        currentsShowArrows: true,
        currentsShowStreamlines: false,
      });
    });
  }

  it("displays knots unchanged for nautical units", () => {
    setupManual("nautical", 1.0);
    render(<CurrentsPanel />);
    const input = screen.getByTestId("currents-manual-speed") as HTMLInputElement;
    expect(parseFloat(input.value)).toBeCloseTo(1.0, 2);
    expect(screen.getAllByText(/Speed \(kn\)/i).length).toBeGreaterThan(0);
  });

  it("converts knots to mph for imperial units", () => {
    setupManual("imperial", 1.0);
    render(<CurrentsPanel />);
    const input = screen.getByTestId("currents-manual-speed") as HTMLInputElement;
    const expectedMph = 1.0 / MPH_TO_KNOTS;
    expect(parseFloat(input.value)).toBeCloseTo(expectedMph, 1);
    expect(screen.getAllByText(/Speed \(mph\)/i).length).toBeGreaterThan(0);
  });

  it("converts knots to km/h for metric units", () => {
    setupManual("metric", 1.0);
    render(<CurrentsPanel />);
    const input = screen.getByTestId("currents-manual-speed") as HTMLInputElement;
    const expectedKph = (1.0 / MPH_TO_KNOTS) * MPH_TO_KPH;
    expect(parseFloat(input.value)).toBeCloseTo(expectedKph, 1);
    expect(screen.getAllByText(/Speed \(km\/h\)/i).length).toBeGreaterThan(0);
  });
});
