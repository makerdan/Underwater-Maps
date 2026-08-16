/**
 * DisplayOverlaysSection data-correctness regression tests.
 *
 * Covers: out-of-range and NaN slider values are clamped before reaching the
 * range input so the HTML never renders invalid state.
 *
 * One group per slider field: hudOpacity, overviewDefaultZoom,
 * habitatOverlayIntensity
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const data = {
    hudOpacity: 0.75,
    overviewDefaultZoom: 1.0,
    habitatOverlayIntensity: 0.4,
  };
  return { data };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    showCrosshairGps: true,
    setShowCrosshairGps: vi.fn(),
    showCameraPosition: true,
    setShowCameraPosition: vi.fn(),
    showHeading: true,
    setShowHeading: vi.fn(),
    coordinateFormat: "decimal" as const,
    setCoordinateFormat: vi.fn(),
    hudOpacity: h.data.hudOpacity,
    setHudOpacity: vi.fn(),
    showDepthLegend: true,
    setShowDepthLegend: vi.fn(),
    showDepthScaleBar: true,
    setShowDepthScaleBar: vi.fn(),
    showCompassMinimap: true,
    setShowCompassMinimap: vi.fn(),
    showControlsLegend: false,
    setShowControlsLegend: vi.fn(),
    showTidePanel: true,
    setShowTidePanel: vi.fn(),
    showHabitatPanel: true,
    setShowHabitatPanel: vi.fn(),
    showDatasetPanel: true,
    setShowDatasetPanel: vi.fn(),
    showQueryPanel: true,
    setShowQueryPanel: vi.fn(),
    showUiTooltips: true,
    setShowUiTooltips: vi.fn(),
    showHealthBadge: false,
    setShowHealthBadge: vi.fn(),
    timeFormat: "local" as const,
    setTimeFormat: vi.fn(),
    overviewShowGrid: true,
    setOverviewShowGrid: vi.fn(),
    overviewShowMarkers: true,
    setOverviewShowMarkers: vi.fn(),
    overviewOpenOnLoad: false,
    setOverviewOpenOnLoad: vi.fn(),
    overviewDefaultZoom: h.data.overviewDefaultZoom,
    setOverviewDefaultZoom: vi.fn(),
    autoShowZoneOverlay: false,
    setAutoShowZoneOverlay: vi.fn(),
    habitatOverlayIntensity: h.data.habitatOverlayIntensity,
    setHabitatOverlayIntensity: vi.fn(),
    defaultHabitatSpecies: "",
    setDefaultHabitatSpecies: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: vi.fn(),
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

vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="advanced-disclosure">{children}</div>
  ),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => null,
}));

vi.mock("@/pages/settings/components/ZoneColourSwatches", () => ({
  ZoneColourSwatches: () => <div data-testid="zone-colour-swatches" />,
}));

import { DisplayOverlaysSection } from "../DisplayOverlaysSection";

beforeEach(() => {
  h.data.hudOpacity = 0.75;
  h.data.overviewDefaultZoom = 1.0;
  h.data.habitatOverlayIntensity = 0.4;
});

describe("DisplayOverlaysSection — hudOpacity slider clamping", () => {
  it("clamps hudOpacity above max to 1.0", () => {
    h.data.hudOpacity = 5;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("HUD Opacity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });

  it("clamps hudOpacity below min to 0.3", () => {
    h.data.hudOpacity = 0;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("HUD Opacity") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.3);
  });

  it("replaces NaN hudOpacity with the field default (0.75)", () => {
    h.data.hudOpacity = NaN;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("HUD Opacity") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.75);
  });
});

describe("DisplayOverlaysSection — overviewDefaultZoom slider clamping", () => {
  it("clamps overviewDefaultZoom above max to 5.0", () => {
    h.data.overviewDefaultZoom = 100;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Default Zoom") as HTMLInputElement;
    expect(Number(slider.value)).toBe(5.0);
  });

  it("clamps overviewDefaultZoom below min to 0.5", () => {
    h.data.overviewDefaultZoom = -1;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Default Zoom") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.5);
  });

  it("replaces NaN overviewDefaultZoom with the field default (1.0)", () => {
    h.data.overviewDefaultZoom = NaN;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Default Zoom") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.0);
  });
});

describe("DisplayOverlaysSection — habitatOverlayIntensity slider clamping", () => {
  it("clamps habitatOverlayIntensity above max to 1", () => {
    h.data.habitatOverlayIntensity = 9;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Overlay Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
  });

  it("clamps habitatOverlayIntensity below min to 0", () => {
    h.data.habitatOverlayIntensity = -0.5;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Overlay Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(0);
  });

  it("replaces NaN habitatOverlayIntensity with the field default (0.4)", () => {
    h.data.habitatOverlayIntensity = NaN;
    render(<DisplayOverlaysSection />);
    const slider = screen.getByLabelText("Overlay Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.4);
  });
});
