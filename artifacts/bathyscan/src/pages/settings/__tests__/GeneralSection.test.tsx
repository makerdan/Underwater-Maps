/**
 * GeneralSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Saltwater / freshwater mode buttons are present
 *   - Clicking a water-type button calls setWaterType
 *   - Save button (SectionActionsRow with withReset=false) is present
 *   - No reset button (GeneralSection passes withReset=false)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const setWaterType = vi.fn();
  const resetSection = vi.fn();
  return { setWaterType, resetSection };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    waterType: "saltwater" as const,
    setWaterType: h.setWaterType,
    units: "metric" as const,
    setUnits: vi.fn(),
    depthUnit: "metres" as const,
    setDepthUnit: vi.fn(),
    temperatureUnit: "auto" as const,
    setTemperatureUnit: vi.fn(),
    defaultMapLoad: null as null,
    setDefaultMapLoad: vi.fn(),
    defaultRegion: "" as const,
    setDefaultRegion: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: h.resetSection,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

vi.mock("@/components/DefaultMapLoadPicker", () => ({
  DefaultMapLoadPicker: () => <div data-testid="default-map-load-picker" />,
}));

import { GeneralSection } from "../GeneralSection";

describe("GeneralSection", () => {
  beforeEach(() => {
    h.setWaterType.mockClear();
    h.resetSection.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<GeneralSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the GENERAL section heading", () => {
    render(<GeneralSection />);
    expect(screen.getByText(/GENERAL/i)).toBeInTheDocument();
  });

  it("renders saltwater mode button", () => {
    render(<GeneralSection />);
    expect(screen.getByTestId("settings-water-type-saltwater")).toBeInTheDocument();
  });

  it("renders freshwater mode button", () => {
    render(<GeneralSection />);
    expect(screen.getByTestId("settings-water-type-freshwater")).toBeInTheDocument();
  });

  it("clicking saltwater button calls setWaterType('saltwater')", () => {
    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-saltwater"));
    expect(h.setWaterType).toHaveBeenCalledWith("saltwater");
  });

  it("clicking freshwater button calls setWaterType('freshwater')", () => {
    render(<GeneralSection />);
    fireEvent.click(screen.getByTestId("settings-water-type-freshwater"));
    expect(h.setWaterType).toHaveBeenCalledWith("freshwater");
  });

  it("renders the save button for the environment section", () => {
    render(<GeneralSection />);
    expect(screen.getByTestId("save-section-environment-btn")).toBeInTheDocument();
  });

  it("does NOT render a reset button (withReset=false)", () => {
    render(<GeneralSection />);
    expect(screen.queryByTestId("reset-section-environment-btn")).not.toBeInTheDocument();
  });

  it("renders the UNITS card header", () => {
    render(<GeneralSection />);
    expect(screen.getByText("UNITS")).toBeInTheDocument();
  });

  it("renders the STARTUP DEFAULTS card header", () => {
    render(<GeneralSection />);
    expect(screen.getByText("STARTUP DEFAULTS")).toBeInTheDocument();
  });
});
