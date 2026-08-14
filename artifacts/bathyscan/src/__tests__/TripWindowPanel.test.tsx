/**
 * TripWindowPanel — display-layer unit conversion tests.
 *
 * Verifies that slider readouts and forecast-window row summaries show values
 * in the user's preferred unit system (Nautical / Metric / Imperial).
 *
 * Storage always stays in canonical kn/m — these tests confirm only the
 * display-conversion responsibility that lives in TripWindowPanel (via
 * formatSpeedFromKnots / formatWaveHeight from lib/units). Pure trip-window
 * logic tests live in lib/__tests__/tripWindow.test.ts.
 *
 * NOTE on integer knot values: formatSpeedFromKnots(12, "nautical") returns
 * "12 kn" (no decimal) because the roundtrip 12 kn → mph → kn lands exactly
 * on the integer and formatSpeed uses String(kt) for whole-number results.
 * Test assertions use the actual output strings, not idealised ".0" forms.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { TripWindowPanel } from "@/components/TripWindowPanel";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// Mock external hooks that reach the network or have DOM side-effects
// ---------------------------------------------------------------------------

/** Two consecutive "go" hours — produces one TripWindow with maxWindKt=8, maxWaveM=0.3. */
vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({
    forecast48h: [
      { relHour: 0, isoTime: "2026-07-18T06:00:00.000Z", windSpeedKnots: 8, waveHeightM: 0.3 },
      { relHour: 1, isoTime: "2026-07-18T07:00:00.000Z", windSpeedKnots: 8, waveHeightM: 0.3 },
    ],
    loading: false,
  }),
}));

vi.mock("@/lib/driftStore", () => ({
  useDriftStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setDriftHour: vi.fn(), setDriftPlannerActive: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel() {
  return render(<TripWindowPanel />);
}

function setUnitsAndThresholds(units: "nautical" | "metric" | "imperial") {
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    units,
    boatGoWindKn: 12,
    boatGoWaveM: 0.8,
    boatNoGoWindKn: 22,
    boatNoGoWaveM: 1.5,
    tripMinDurationH: 0,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
});

// ---------------------------------------------------------------------------
// Slider readout tests
// ---------------------------------------------------------------------------

describe("TripWindowPanel slider readouts — unit conversion", () => {
  it("shows knots and metres in Nautical mode", () => {
    setUnitsAndThresholds("nautical");
    renderPanel();

    // formatSpeedFromKnots(12) for nautical: roundtrips to exact integer → "12 kn" (no ".0")
    expect(screen.getByTestId("boat-go-wind-readout").textContent).toBe("12 kn");
    expect(screen.getByTestId("boat-go-wave-readout").textContent).toBe("0.8 m");
    // formatSpeedFromKnots(22) for nautical: exact integer → "22 kn"
    expect(screen.getByTestId("boat-nogo-wind-readout").textContent).toBe("22 kn");
    expect(screen.getByTestId("boat-nogo-wave-readout").textContent).toBe("1.5 m");
  });

  it("shows km/h and metres in Metric mode", () => {
    setUnitsAndThresholds("metric");
    renderPanel();

    // 12 kn → mph → km/h ≈ 22.2 km/h
    expect(screen.getByTestId("boat-go-wind-readout").textContent).toBe("22.2 km/h");
    expect(screen.getByTestId("boat-go-wave-readout").textContent).toBe("0.8 m");
    // 22 kn → km/h ≈ 40.7 km/h
    expect(screen.getByTestId("boat-nogo-wind-readout").textContent).toBe("40.7 km/h");
    expect(screen.getByTestId("boat-nogo-wave-readout").textContent).toBe("1.5 m");
  });

  it("shows mph and feet in Imperial mode", () => {
    setUnitsAndThresholds("imperial");
    renderPanel();

    // 12 kn → mph ≈ 13.8 mph
    expect(screen.getByTestId("boat-go-wind-readout").textContent).toBe("13.8 mph");
    // 0.8 m × 3.28084 ≈ 2.6 ft
    expect(screen.getByTestId("boat-go-wave-readout").textContent).toBe("2.6 ft");
    // 22 kn → mph ≈ 25.3 mph
    expect(screen.getByTestId("boat-nogo-wind-readout").textContent).toBe("25.3 mph");
    // 1.5 m × 3.28084 ≈ 4.9 ft
    expect(screen.getByTestId("boat-nogo-wave-readout").textContent).toBe("4.9 ft");
  });
});

// ---------------------------------------------------------------------------
// Window-row summary tests
// ---------------------------------------------------------------------------
// The mocked forecast produces one window: maxWindKt=8, maxWaveM=0.3.
// Use getByTestId("trip-window-0").textContent to avoid matching slider
// readout elements that also contain speed/wave strings.

describe("TripWindowPanel window-row summaries — unit conversion", () => {
  it("shows knots and metres in the window row for Nautical", () => {
    setUnitsAndThresholds("nautical");
    renderPanel();

    // formatSpeedFromKnots(8) for nautical → exact integer → "8 kn"
    const row = screen.getByTestId("trip-window-0");
    expect(row.textContent).toContain("8 kn");
    expect(row.textContent).toContain("0.3 m");
  });

  it("shows km/h and metres in the window row for Metric", () => {
    setUnitsAndThresholds("metric");
    renderPanel();

    // 8 kn → ≈ 14.8 km/h; wave stays in metres
    const row = screen.getByTestId("trip-window-0");
    expect(row.textContent).toContain("14.8 km/h");
    expect(row.textContent).toContain("0.3 m");
  });

  it("shows mph and feet in the window row for Imperial", () => {
    setUnitsAndThresholds("imperial");
    renderPanel();

    // 8 kn → ≈ 9.2 mph; 0.3 m × 3.28084 ≈ 1.0 ft
    const row = screen.getByTestId("trip-window-0");
    expect(row.textContent).toContain("9.2 mph");
    expect(row.textContent).toContain("1.0 ft");
  });
});

// ---------------------------------------------------------------------------
// Aria-label tests (screen-reader announcements)
// ---------------------------------------------------------------------------

describe("TripWindowPanel slider aria-labels — unit conversion", () => {
  it("aria-labels reference the formatted unit string for Nautical", () => {
    setUnitsAndThresholds("nautical");
    renderPanel();

    // "12 kn" not "12.0 kn" — integer roundtrip
    expect(screen.getByTestId("boat-go-wind").getAttribute("aria-label")).toContain("12 kn");
    expect(screen.getByTestId("boat-go-wave").getAttribute("aria-label")).toContain("0.8 m");
  });

  it("aria-labels reference the formatted unit string for Imperial", () => {
    setUnitsAndThresholds("imperial");
    renderPanel();

    expect(screen.getByTestId("boat-go-wind").getAttribute("aria-label")).toContain("13.8 mph");
    expect(screen.getByTestId("boat-go-wave").getAttribute("aria-label")).toContain("2.6 ft");
  });
});
