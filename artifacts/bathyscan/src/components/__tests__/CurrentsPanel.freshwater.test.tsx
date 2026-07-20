/**
 * CurrentsPanel — freshwater-mode data-availability tests.
 *
 * Verifies that:
 *   1. When waterType=freshwater and tidalStatus="unavailable", the panel shows
 *      DataUnavailable instead of the saltwater "No NOAA station" message.
 *   2. When waterType=freshwater and noaaAmbient.source="estimated" (sinusoidal
 *      synthetic), the panel shows DataUnavailable, NOT the estimate reading.
 *   3. When waterType=freshwater and noaaAmbient.source="usgs" (real data),
 *      the panel shows the real current vector.
 *   4. Saltwater + estimated still shows "No NOAA station in range — using
 *      tide-derived estimate." (regression guard).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── vi.hoisted: all state visible before mock factories run ────────────────────

const h = vi.hoisted(() => {
  let waterType: "saltwater" | "freshwater" = "saltwater";
  let currentsEnabled = true;
  let currentsSource: "manual" | "noaa" = "noaa";

  return {
    get waterType() { return waterType; },
    set waterType(v) { waterType = v; },
    get currentsEnabled() { return currentsEnabled; },
    set currentsEnabled(v) { currentsEnabled = v; },
    get currentsSource() { return currentsSource; },
    set currentsSource(v) { currentsSource = v; },
  };
});

// ── Mock stores ────────────────────────────────────────────────────────────────

vi.mock("@/lib/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/context")>();
  return { ...actual, useAppState: () => ({ terrain: null }) };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const settingsState = () => ({
    units: "nautical" as const,
    waterType: h.waterType,
    currentsEnabled: h.currentsEnabled,
    setCurrentsEnabled: vi.fn(),
    currentsSource: h.currentsSource,
    setCurrentsSource: vi.fn(),
    currentsManualDirectionDeg: 90,
    setCurrentsManualDirectionDeg: vi.fn(),
    currentsManualSpeedKt: 0.5,
    setCurrentsManualSpeedKt: vi.fn(),
    currentsTidePhase: 0,
    setCurrentsTidePhase: vi.fn(),
    currentsAutoAdvance: false,
    setCurrentsAutoAdvance: vi.fn(),
    currentsShowParticles: true,
    setCurrentsShowParticles: vi.fn(),
    currentsShowArrows: true,
    setCurrentsShowArrows: vi.fn(),
    currentsShowStreamlines: false,
    setCurrentsShowStreamlines: vi.fn(),
    currentArrowDensity: "normal" as const,
    layerArrowDensity: {},
    manualConditionsActiveSource: {} as Record<string, "real" | "manual">,
    setManualConditionsActiveSource: vi.fn(),
    datasetManualConditions: {},
    setDatasetManualConditions: vi.fn(),
  });
  const useSettingsStore = Object.assign(
    (sel: (s: ReturnType<typeof settingsState>) => unknown) => sel(settingsState()),
    {
      getState: settingsState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

const currentsStoreState = {
  field: null,
  noaaAmbient: null as null | { directionDeg: number; speedKt: number; source?: "noaa" | "usgs" | "glerl" | "estimated"; stationId?: string; stationName?: string },
  tidalStatus: "idle" as "idle" | "loading" | "ok" | "unavailable",
  retryTidal: vi.fn(),
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/lib/currentsStore", () => ({
  useCurrentsStore: (sel: (s: typeof currentsStoreState) => unknown) => sel(currentsStoreState),
}));

vi.mock("@/lib/timelineStore", () => ({
  useTimelineStore: (sel: (s: { currentTime: Date }) => unknown) =>
    sel({ currentTime: new Date() }),
}));

vi.mock("@/lib/uiStore", () => ({
  useTimelineVisible: () => false,
  useUiStore: vi.fn(),
}));

vi.mock("@/components/AdvancedSection", () => ({
  AdvancedSection: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "advanced-section" }, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CurrentsPanel — freshwater unavailable paths", () => {
  beforeEach(() => {
    h.waterType = "saltwater";
    h.currentsEnabled = true;
    h.currentsSource = "noaa";
    currentsStoreState.noaaAmbient = null;
    currentsStoreState.tidalStatus = "idle";
  });

  it("freshwater + unavailable: shows DataUnavailable (not NOAA message)", async () => {
    h.waterType = "freshwater";
    currentsStoreState.tidalStatus = "unavailable";

    const { CurrentsPanel } = await import("@/components/CurrentsPanel");
    render(<CurrentsPanel />);

    expect(screen.getByTestId("currents-freshwater-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("currents-noaa-unavailable")).toBeNull();
  });

  it("freshwater + estimated source: shows DataUnavailable, not estimate reading", async () => {
    h.waterType = "freshwater";
    currentsStoreState.tidalStatus = "ok";
    currentsStoreState.noaaAmbient = {
      directionDeg: 180,
      speedKt: 0.4,
      source: "estimated",
    };

    const { CurrentsPanel } = await import("@/components/CurrentsPanel");
    render(<CurrentsPanel />);

    expect(screen.getByTestId("currents-freshwater-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("currents-noaa-estimated")).toBeNull();
  });

  it("freshwater + usgs source: shows the real current vector readout", async () => {
    h.waterType = "freshwater";
    currentsStoreState.tidalStatus = "ok";
    currentsStoreState.noaaAmbient = {
      directionDeg: 90,
      speedKt: 0.3,
      source: "usgs",
      stationId: "04082500",
      stationName: "Fox River",
    };

    const { CurrentsPanel } = await import("@/components/CurrentsPanel");
    render(<CurrentsPanel />);

    expect(screen.queryByTestId("currents-freshwater-unavailable")).toBeNull();
    const readout = screen.getByTestId("currents-noaa-readout");
    expect(readout).toHaveTextContent("USGS");
    expect(readout).toHaveTextContent("90°");
  });

  it("saltwater + estimated: still shows tide-derived estimate notice (regression guard)", async () => {
    h.waterType = "saltwater";
    currentsStoreState.tidalStatus = "ok";
    currentsStoreState.noaaAmbient = {
      directionDeg: 270,
      speedKt: 0.5,
      source: "estimated",
    };

    const { CurrentsPanel } = await import("@/components/CurrentsPanel");
    render(<CurrentsPanel />);

    expect(screen.getByTestId("currents-noaa-estimated")).toBeInTheDocument();
    expect(screen.queryByTestId("currents-freshwater-unavailable")).toBeNull();
  });
});
