/**
 * VisualsSection data-correctness regression tests.
 *
 * Covers: out-of-range and NaN slider values are clamped before reaching the
 * range input so the HTML never renders invalid state.
 *
 * One group per slider field:
 *   terrainExaggeration, fogDensity, ambientLightIntensity,
 *   directionalLightIntensity, lampIntensity, lampRange
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => {
  const data = {
    terrainExaggeration: 1.0,
    fogDensity: 0.012,
    ambientLightIntensity: 0.05,
    directionalLightIntensity: 0.35,
    lampIntensity: 2.0,
    lampRange: 40,
  };
  return { data };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    qualityPreset: "high" as const,
    setQualityPreset: vi.fn(),
    applyQualityPreset: vi.fn(),
    terrainExaggeration: h.data.terrainExaggeration,
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
    fogDensity: h.data.fogDensity,
    setFogDensity: vi.fn(),
    fogColor: "#001a33",
    setFogColor: vi.fn(),
    nodataColor: "#bfbfbf",
    setNodataColor: vi.fn(),
    ambientLightIntensity: h.data.ambientLightIntensity,
    setAmbientLightIntensity: vi.fn(),
    directionalLightIntensity: h.data.directionalLightIntensity,
    setDirectionalLightIntensity: vi.fn(),
    lampIntensity: h.data.lampIntensity,
    setLampIntensity: vi.fn(),
    lampRange: h.data.lampRange,
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
    brightDaylight: false,
    colormapUserSet: false,
    maxActiveDatasets: 3,
    setMaxActiveDatasets: vi.fn(),
    proximityMode: true,
    setProximityMode: vi.fn(),
    intertidalMhwOverrideFt: null,
    intertidalMhhwOverrideFt: null,
    setIntertidalMhwOverrideFt: vi.fn(),
    setIntertidalMhhwOverrideFt: vi.fn(),
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

vi.mock("@/components/PaletteSuggestionBanner", () => ({
  PaletteSuggestionBanner: () => <div data-testid="palette-suggestion-banner" />,
}));

vi.mock("@/pages/settings/components/PalettePickerCard", () => ({
  PalettePickerCard: () => <div data-testid="palette-picker-card" />,
}));

vi.mock("@/pages/settings/components/DepthColorsCard", () => ({
  DepthColorsCard: () => <div data-testid="depth-colors-card" />,
}));

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => null,
}));

import { VisualsSection } from "../VisualsSection";

beforeEach(() => {
  h.data.terrainExaggeration = 1.0;
  h.data.fogDensity = 0.012;
  h.data.ambientLightIntensity = 0.05;
  h.data.directionalLightIntensity = 0.35;
  h.data.lampIntensity = 2.0;
  h.data.lampRange = 40;
});

describe("VisualsSection — terrainExaggeration slider clamping", () => {
  it("clamps an out-of-range terrainExaggeration above max to 20", () => {
    h.data.terrainExaggeration = 999;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Vertical Exaggeration") as HTMLInputElement;
    expect(Number(slider.value)).toBe(20);
  });

  it("clamps terrainExaggeration below min to 1", () => {
    h.data.terrainExaggeration = -5;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Vertical Exaggeration") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
  });

  it("replaces NaN terrainExaggeration with the field default (1)", () => {
    h.data.terrainExaggeration = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Vertical Exaggeration") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
  });
});

describe("VisualsSection — fogDensity slider clamping", () => {
  it("clamps an out-of-range fogDensity above max to 0.030", () => {
    h.data.fogDensity = 1.0;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Fog Density") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.030);
  });

  it("clamps fogDensity below min to 0.004", () => {
    h.data.fogDensity = 0;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Fog Density") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.004);
  });

  it("replaces NaN fogDensity with the field default (0.012)", () => {
    h.data.fogDensity = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Fog Density") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.012);
  });
});

describe("VisualsSection — ambientLightIntensity slider clamping", () => {
  it("clamps ambientLightIntensity above max to 1", () => {
    h.data.ambientLightIntensity = 5;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Ambient Light Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1);
  });

  it("replaces NaN ambientLightIntensity with the field default (0.05)", () => {
    h.data.ambientLightIntensity = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Ambient Light Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.05);
  });
});

describe("VisualsSection — directionalLightIntensity slider clamping", () => {
  it("clamps directionalLightIntensity above max to 1.5", () => {
    h.data.directionalLightIntensity = 100;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Directional Light Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(1.5);
  });

  it("replaces NaN directionalLightIntensity with the field default (0.35)", () => {
    h.data.directionalLightIntensity = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Directional Light Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBeCloseTo(0.35);
  });
});

describe("VisualsSection — lampIntensity slider clamping", () => {
  it("clamps lampIntensity above max to 5", () => {
    h.data.lampIntensity = 50;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Lamp Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(5);
  });

  it("replaces NaN lampIntensity with the field default (2)", () => {
    h.data.lampIntensity = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Lamp Intensity") as HTMLInputElement;
    expect(Number(slider.value)).toBe(2);
  });
});

describe("VisualsSection — lampRange slider clamping", () => {
  it("clamps lampRange above max to 150", () => {
    h.data.lampRange = 9999;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Lamp Range") as HTMLInputElement;
    expect(Number(slider.value)).toBe(150);
  });

  it("clamps lampRange below min to 10", () => {
    h.data.lampRange = 0;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Lamp Range") as HTMLInputElement;
    expect(Number(slider.value)).toBe(10);
  });

  it("replaces NaN lampRange with the field default (40)", () => {
    h.data.lampRange = NaN;
    render(<VisualsSection />);
    const slider = screen.getByLabelText("Lamp Range") as HTMLInputElement;
    expect(Number(slider.value)).toBe(40);
  });
});
