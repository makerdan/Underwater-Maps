/**
 * PaletteSection regression guard.
 *
 * Verifies:
 *   1. PaletteSection renders the DepthColorsCard and PaletteSuggestionBanner.
 *   2. VisualsSection renders NEITHER DepthColorsCard nor PaletteSuggestionBanner.
 *   3. SECTION_KEYS["palette"] owns the moved palette keys.
 *   4. SECTION_KEYS["visuals"] no longer owns those keys.
 *   5. resetSection("palette") restores palette keys while leaving a visuals key
 *      (fogDensity) untouched.
 *   6. resetSection("visuals") leaves palette keys (colormapTheme) untouched.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  return { resetSection, stateOverrides };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    qualityPreset: "high" as const,
    setQualityPreset: vi.fn(),
    applyQualityPreset: vi.fn(),
    terrainExaggeration: 1.0,
    setTerrainExaggeration: vi.fn(),
    enableMarineSnow: false,
    setEnableMarineSnow: vi.fn(),
    particleDensity: "sparse" as const,
    setParticleDensity: vi.fn(),
    enableCaustics: false,
    setEnableCaustics: vi.fn(),
    colormapTheme: "ocean" as const,
    setColormapThemeByUser: vi.fn(),
    setColormapTheme: vi.fn(),
    contoursEnabled: false,
    setContoursEnabled: vi.fn(),
    contourInterval: 10,
    setContourInterval: vi.fn(),
    units: "imperial" as const,
    textureQuality: "high" as const,
    setTextureQuality: vi.fn(),
    antialiasing: true,
    setAntialiasing: vi.fn(),
    fogDensity: 0.012,
    setFogDensity: vi.fn(),
    fogColor: "#001a33",
    setFogColor: vi.fn(),
    nodataColor: "#bfbfbf",
    setNodataColor: vi.fn(),
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
    showNodataBoundary: true,
    setShowNodataBoundary: vi.fn(),
    showLandmass: false,
    setShowLandmass: vi.fn(),
    satelliteImagery: false,
    setSatelliteImagery: vi.fn(),
    landmassStyle: "realistic" as const,
    setLandmassStyle: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: h.resetSection,
    intertidalMhwOverrideFt: null,
    intertidalMhhwOverrideFt: null,
    setIntertidalMhwOverrideFt: vi.fn(),
    setIntertidalMhhwOverrideFt: vi.fn(),
    brightDaylight: false,
    colormapUserSet: false,
    maxActiveDatasets: 3,
    setMaxActiveDatasets: vi.fn(),
    proximityMode: true,
    setProximityMode: vi.fn(),
    ...h.stateOverrides,
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

vi.mock("@/lib/uiStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uiStore")>();
  return {
    ...actual,
    useUiStore: Object.assign(
      <T,>(sel: (s: { setShowNodataBoundary: (v: boolean) => void; showNodataBoundary: boolean }) => T) =>
        sel({ setShowNodataBoundary: vi.fn(), showNodataBoundary: true }),
      { getState: () => ({ setShowNodataBoundary: vi.fn(), showNodataBoundary: true }), setState: vi.fn(), subscribe: () => () => {} },
    ),
  };
});

vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="advanced-disclosure">{children}</div>
  ),
}));

vi.mock("@/components/PaletteSuggestionBanner", () => ({
  PaletteSuggestionBanner: () => <div data-testid="palette-suggestion-banner" />,
}));

vi.mock("@/pages/settings/components/DepthColorsCard", () => ({
  DepthColorsCard: () => <div data-testid="depth-colors-card" />,
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { PaletteSection } from "../PaletteSection";
import { VisualsSection } from "../VisualsSection";
import { SECTION_KEYS } from "@/lib/settingsStore";

describe("PaletteSection regression guard", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    for (const k of Object.keys(h.stateOverrides)) delete h.stateOverrides[k];
  });

  // ── 1. Component rendering ────────────────────────────────────────────────

  it("PaletteSection renders the DepthColorsCard", () => {
    render(<PaletteSection />);
    expect(screen.getByTestId("depth-colors-card")).toBeInTheDocument();
  });

  it("PaletteSection renders the PaletteSuggestionBanner", () => {
    render(<PaletteSection />);
    expect(screen.getByTestId("palette-suggestion-banner")).toBeInTheDocument();
  });

  it("PaletteSection renders the section title text", () => {
    render(<PaletteSection />);
    expect(screen.getByText(/DEPTH COLOR PALETTE/i)).toBeInTheDocument();
  });

  it("PaletteSection renders the section save button", () => {
    render(<PaletteSection />);
    expect(screen.getByTestId("save-section-palette-btn")).toBeInTheDocument();
  });

  it("PaletteSection renders the section reset button", () => {
    render(<PaletteSection />);
    expect(screen.getByTestId("reset-section-palette-btn")).toBeInTheDocument();
  });

  it("VisualsSection does NOT render DepthColorsCard", () => {
    render(<VisualsSection />);
    expect(screen.queryByTestId("depth-colors-card")).not.toBeInTheDocument();
  });

  it("VisualsSection does NOT render PaletteSuggestionBanner", () => {
    render(<VisualsSection />);
    expect(screen.queryByTestId("palette-suggestion-banner")).not.toBeInTheDocument();
  });

  // ── 2. SECTION_KEYS membership ───────────────────────────────────────────

  it("SECTION_KEYS['palette'] contains colormapTheme", () => {
    expect(SECTION_KEYS["palette"]).toContain("colormapTheme");
  });

  it("SECTION_KEYS['palette'] contains colormapUserSet", () => {
    expect(SECTION_KEYS["palette"]).toContain("colormapUserSet");
  });

  it("SECTION_KEYS['palette'] contains nodataColor", () => {
    expect(SECTION_KEYS["palette"]).toContain("nodataColor");
  });

  it("SECTION_KEYS['palette'] contains contoursEnabled", () => {
    expect(SECTION_KEYS["palette"]).toContain("contoursEnabled");
  });

  it("SECTION_KEYS['palette'] contains contourInterval", () => {
    expect(SECTION_KEYS["palette"]).toContain("contourInterval");
  });

  it("SECTION_KEYS['visuals'] does NOT contain colormapTheme", () => {
    expect(SECTION_KEYS["visuals"]).not.toContain("colormapTheme");
  });

  it("SECTION_KEYS['visuals'] does NOT contain nodataColor", () => {
    expect(SECTION_KEYS["visuals"]).not.toContain("nodataColor");
  });

  it("SECTION_KEYS['visuals'] does NOT contain contoursEnabled", () => {
    expect(SECTION_KEYS["visuals"]).not.toContain("contoursEnabled");
  });

  it("SECTION_KEYS['visuals'] does NOT contain contourInterval", () => {
    expect(SECTION_KEYS["visuals"]).not.toContain("contourInterval");
  });

  // Note: resetSection isolation tests (palette vs visuals cross-contamination)
  // live in settingsStore.test.ts where the real Zustand store is used.
});
