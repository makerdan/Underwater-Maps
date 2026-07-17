/**
 * MapLayersSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key controls present (Show Marker Labels, Private Markers, Auto-Load Tidal Data)
 *   - Save and reset buttons (SectionActionsRow sections=["markers","gps","tidal","currents"]) present
 *   - Clicking reset calls resetSection for all associated sections
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  return { resetSection };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    waterType: "saltwater" as const,
    showMarkerLabels: true,
    setShowMarkerLabels: vi.fn(),
    privateMarkers: false,
    setPrivateMarkers: vi.fn(),
    defaultMarkerType: "fish" as const,
    setDefaultMarkerType: vi.fn(),
    visibleMarkerTypes: ["fish", "shipwreck", "coral", "vent", "custom", "depth_pole"] as import("@/lib/settingsStore").MarkerType[],
    setVisibleMarkerTypes: vi.fn(),
    autoStartTrailRecording: false,
    setAutoStartTrailRecording: vi.fn(),
    defaultTrailColor: "#00e5ff",
    setDefaultTrailColor: vi.fn(),
    gpsRecordingInterval: 2000,
    setGpsRecordingInterval: vi.fn(),
    defaultDepthPoleColor: "#ff6600",
    setDefaultDepthPoleColor: vi.fn(),
    markerClusterThreshold: 50,
    setMarkerClusterThreshold: vi.fn(),
    trailRetention: "30" as const,
    setTrailRetention: vi.fn(),
    autoLoadTidal: true,
    setAutoLoadTidal: vi.fn(),
    defaultTidalDepthLayer: "surface" as const,
    setDefaultTidalDepthLayer: vi.fn(),
    currentsEnabled: false,
    setCurrentsEnabled: vi.fn(),
    currentsSource: "manual" as const,
    setCurrentsSource: vi.fn(),
    currentsManualDirectionDeg: 90,
    setCurrentsManualDirectionDeg: vi.fn(),
    currentsManualSpeedKt: 1.0,
    setCurrentsManualSpeedKt: vi.fn(),
    currentArrowDensity: "normal" as const,
    setCurrentArrowDensity: vi.fn(),
    layerArrowDensity: { surface: "normal" as const, mid: "normal" as const, "near-bottom": "sparse" as const },
    setLayerArrowDensity: vi.fn(),
    windOverlayStyle: "arrows" as const,
    setWindOverlayStyle: vi.fn(),
    tideOverlayStyle: "arrows" as const,
    setTideOverlayStyle: vi.fn(),
    currentOverlayStyle: "arrows" as const,
    setCurrentOverlayStyle: vi.fn(),
    currentsShowParticles: true,
    setCurrentsShowParticles: vi.fn(),
    currentsShowArrows: true,
    setCurrentsShowArrows: vi.fn(),
    currentsShowStreamlines: false,
    setCurrentsShowStreamlines: vi.fn(),
    currentsAutoAdvance: false,
    setCurrentsAutoAdvance: vi.fn(),
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

import { MapLayersSection } from "../MapLayersSection";

describe("MapLayersSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<MapLayersSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the MAP LAYERS heading text", () => {
    render(<MapLayersSection />);
    expect(screen.getByText(/MAP LAYERS/i)).toBeInTheDocument();
  });

  it("renders MARKERS & TRAILS card header", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("MARKERS & TRAILS")).toBeInTheDocument();
  });

  it("renders Show Marker Labels label", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("Show Marker Labels")).toBeInTheDocument();
  });

  it("renders Private Markers label", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("Private Markers")).toBeInTheDocument();
  });

  it("renders Auto-Load Tidal Data label", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("Auto-Load Tidal Data")).toBeInTheDocument();
  });

  it("renders Enable Currents Simulation label", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("Enable Currents Simulation")).toBeInTheDocument();
  });

  it("renders TIDES & CURRENTS card header", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("TIDES & CURRENTS")).toBeInTheDocument();
  });

  it("renders TRAILS card header", () => {
    render(<MapLayersSection />);
    expect(screen.getByText("TRAILS")).toBeInTheDocument();
  });

  it("renders the save button for markers section", () => {
    render(<MapLayersSection />);
    expect(screen.getByTestId("save-section-markers-btn")).toBeInTheDocument();
  });

  it("renders the reset button for markers section", () => {
    render(<MapLayersSection />);
    expect(screen.getByTestId("reset-section-markers-btn")).toBeInTheDocument();
  });

  it("clicking reset calls resetSection for all 4 layer sections", () => {
    render(<MapLayersSection />);
    fireEvent.click(screen.getByTestId("reset-section-markers-btn"));
    expect(h.resetSection).toHaveBeenCalledWith("markers");
    expect(h.resetSection).toHaveBeenCalledWith("gps");
    expect(h.resetSection).toHaveBeenCalledWith("tidal");
    expect(h.resetSection).toHaveBeenCalledWith("currents");
  });
});
