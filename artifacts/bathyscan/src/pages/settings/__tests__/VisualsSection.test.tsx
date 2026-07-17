/**
 * VisualsSection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key controls are present (quality preset, terrain exaggeration, marine snow, caustics, colormap)
 *   - Save and reset buttons (SectionActionsRow section="visuals") are present
 *   - Clicking reset calls resetSection("visuals")
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
    qualityPreset: "high" as const,
    setQualityPreset: vi.fn(),
    applyQualityPreset: vi.fn(),
    terrainExaggeration: 1.0,
    setTerrainExaggeration: vi.fn(),
    enableMarineSnow: true,
    setEnableMarineSnow: vi.fn(),
    particleDensity: "sparse" as const,
    setParticleDensity: vi.fn(),
    enableCaustics: false,
    setEnableCaustics: vi.fn(),
    colormapTheme: "ocean" as const,
    setColormapThemeByUser: vi.fn(),
    contoursEnabled: true,
    setContoursEnabled: vi.fn(),
    contourInterval: 10,
    setContourInterval: vi.fn(),
    units: "metric" as const,
    setUnits: vi.fn(),
    textureQuality: "high" as const,
    setTextureQuality: vi.fn(),
    antialiasing: true,
    setAntialiasing: vi.fn(),
    fogDensity: 0.012,
    setFogDensity: vi.fn(),
    fogColor: "#001a33",
    setFogColor: vi.fn(),
    ambientLightIntensity: 0.4,
    setAmbientLightIntensity: vi.fn(),
    directionalLightIntensity: 0.6,
    setDirectionalLightIntensity: vi.fn(),
    lampIntensity: 1.5,
    setLampIntensity: vi.fn(),
    lampRange: 60,
    setLampRange: vi.fn(),
    smoothTerrainSpikes: true,
    setSmoothTerrainSpikes: vi.fn(),
    showWaterSurface: true,
    setShowWaterSurface: vi.fn(),
    showLandmass: true,
    setShowLandmass: vi.fn(),
    satelliteImagery: false,
    setSatelliteImagery: vi.fn(),
    landmassStyle: "realistic" as const,
    setLandmassStyle: vi.fn(),
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

vi.mock("@/components/PaletteSuggestionBanner", () => ({
  PaletteSuggestionBanner: () => <div data-testid="palette-suggestion-banner" />,
}));

vi.mock("@/pages/settings/components/PalettePickerCard", () => ({
  PalettePickerCard: () => <div data-testid="palette-picker-card" />,
}));

vi.mock("@/pages/settings/components/ZoneColourSwatches", () => ({
  ZoneColourSwatches: () => <div data-testid="zone-colour-swatches" />,
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { VisualsSection } from "../VisualsSection";

describe("VisualsSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<VisualsSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the VISUALS heading text", () => {
    render(<VisualsSection />);
    expect(screen.getByText(/VISUALS/i)).toBeInTheDocument();
  });

  it("renders QUALITY PRESET label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("QUALITY PRESET")).toBeInTheDocument();
  });

  it("renders Terrain Exaggeration label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Terrain Exaggeration")).toBeInTheDocument();
  });

  it("renders Marine Snow Effect label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Marine Snow Effect")).toBeInTheDocument();
  });

  it("renders Caustics Effect label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Caustics Effect")).toBeInTheDocument();
  });

  it("renders Depth Colormap label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Depth Colormap")).toBeInTheDocument();
  });

  it("renders Show Contour Lines label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Show Contour Lines")).toBeInTheDocument();
  });

  it("renders the save button for visuals section", () => {
    render(<VisualsSection />);
    expect(screen.getByTestId("save-section-visuals-btn")).toBeInTheDocument();
  });

  it("renders the reset button for visuals section", () => {
    render(<VisualsSection />);
    expect(screen.getByTestId("reset-section-visuals-btn")).toBeInTheDocument();
  });

  it("clicking the reset button calls resetSection('visuals')", () => {
    render(<VisualsSection />);
    fireEvent.click(screen.getByTestId("reset-section-visuals-btn"));
    expect(h.resetSection).toHaveBeenCalledWith("visuals");
  });

  it("renders nested BASICS card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("BASICS")).toBeInTheDocument();
  });

  it("renders nested DEPTH DISPLAY card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("DEPTH DISPLAY")).toBeInTheDocument();
  });
});
