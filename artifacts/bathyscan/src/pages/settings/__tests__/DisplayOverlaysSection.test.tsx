/**
 * DisplayOverlaysSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key toggles present (Crosshair GPS, Heading, Show Grid Lines, Show Markers)
 *   - Coordinate Format and HUD Opacity controls present
 *   - Save button (SectionActionsRow withReset=false) is present
 *   - No reset button (DisplayOverlaysSection passes withReset=false)
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  return { resetSection };
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
    hudOpacity: 0.85,
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
    showHealthBadge: true,
    setShowHealthBadge: vi.fn(),
    timeFormat: "local" as const,
    setTimeFormat: vi.fn(),
    overviewShowGrid: true,
    setOverviewShowGrid: vi.fn(),
    overviewShowMarkers: true,
    setOverviewShowMarkers: vi.fn(),
    overviewOpenOnLoad: false,
    setOverviewOpenOnLoad: vi.fn(),
    overviewDefaultZoom: 1.0,
    setOverviewDefaultZoom: vi.fn(),
    autoShowZoneOverlay: false,
    setAutoShowZoneOverlay: vi.fn(),
    habitatOverlayIntensity: 0.5,
    setHabitatOverlayIntensity: vi.fn(),
    defaultHabitatSpecies: "",
    setDefaultHabitatSpecies: vi.fn(),
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

vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="advanced-disclosure">{children}</div>
  ),
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/components/ZoneColourSwatches", () => ({
  ZoneColourSwatches: () => <div data-testid="zone-colour-swatches" />,
}));

import { DisplayOverlaysSection } from "../DisplayOverlaysSection";

describe("DisplayOverlaysSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<DisplayOverlaysSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the DISPLAY & OVERLAYS heading text", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByRole("heading", { name: /DISPLAY/i })).toBeInTheDocument();
  });

  it("renders HUD & LAYOUT card header", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("HUD & LAYOUT")).toBeInTheDocument();
  });

  it("renders VISIBILITY card header", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("VISIBILITY")).toBeInTheDocument();
  });

  it("renders Crosshair GPS label", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("Crosshair GPS")).toBeInTheDocument();
  });

  it("renders Heading label", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("Heading")).toBeInTheDocument();
  });

  it("renders Coordinate Format label", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("Coordinate Format")).toBeInTheDocument();
  });

  it("renders HUD Opacity label", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("HUD Opacity")).toBeInTheDocument();
  });

  it("renders OVERVIEW MAP card header", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("OVERVIEW MAP")).toBeInTheDocument();
  });

  it("renders Show Grid Lines label", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByText("Show Grid Lines")).toBeInTheDocument();
  });

  it("renders the save button for hud section", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByTestId("save-section-hud-btn")).toBeInTheDocument();
  });

  it("does NOT render a reset button (withReset=false)", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.queryByTestId("reset-section-hud-btn")).not.toBeInTheDocument();
  });
});
