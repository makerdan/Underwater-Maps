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
import { render, screen, fireEvent, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  const setIntertidalMhwOverrideFt = vi.fn();
  const setIntertidalMhhwOverrideFt = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  return { resetSection, setIntertidalMhwOverrideFt, setIntertidalMhhwOverrideFt, stateOverrides };
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
    setIntertidalMhwOverrideFt: h.setIntertidalMhwOverrideFt,
    setIntertidalMhhwOverrideFt: h.setIntertidalMhhwOverrideFt,
    brightDaylight: false,
    colormapUserSet: false,
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

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { VisualsSection } from "../VisualsSection";
import { useTidalStore } from "@/lib/tidalStore";

describe("VisualsSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    for (const k of Object.keys(h.stateOverrides)) delete h.stateOverrides[k];
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

  it("renders Vertical Exaggeration label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Vertical Exaggeration")).toBeInTheDocument();
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

  it("does NOT render the Zone Colours card (it lives in Display & Overlays)", () => {
    render(<VisualsSection />);
    expect(screen.queryByText("ZONE COLOURS")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-zone-colours-reset")).not.toBeInTheDocument();
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

  it("renders nested TERRAIN SHADING card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("TERRAIN SHADING")).toBeInTheDocument();
  });

  it("renders TERRAIN SHADING card header inside the AdvancedDisclosure wrapper", () => {
    render(<VisualsSection />);
    const advanced = screen.getByTestId("advanced-disclosure");
    expect(advanced).toBeInTheDocument();
    const { getByText } = within(advanced);
    expect(getByText("TERRAIN SHADING")).toBeInTheDocument();
  });

  it("renders Show water surface toggle inside the AdvancedDisclosure wrapper", () => {
    render(<VisualsSection />);
    const advanced = screen.getByTestId("advanced-disclosure");
    const { getByText } = within(advanced);
    expect(getByText("Show water surface")).toBeInTheDocument();
  });

  it("renders Show landmass toggle inside the AdvancedDisclosure wrapper", () => {
    render(<VisualsSection />);
    const advanced = screen.getByTestId("advanced-disclosure");
    const { getByText } = within(advanced);
    expect(getByText("Show landmass")).toBeInTheDocument();
  });

  it("renders Smooth terrain spikes toggle inside the AdvancedDisclosure wrapper", () => {
    render(<VisualsSection />);
    const advanced = screen.getByTestId("advanced-disclosure");
    const { getByText } = within(advanced);
    expect(getByText("Smooth terrain spikes")).toBeInTheDocument();
  });

  it("renders nested EFFECTS card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("EFFECTS")).toBeInTheDocument();
  });

  it("renders the Antialiasing label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Antialiasing")).toBeInTheDocument();
  });

  it("renders the antialiasing reload-hint badge with appropriate text", () => {
    render(<VisualsSection />);
    const hint = screen.getByTestId("antialiasing-reload-hint");
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/takes effect after reload/i);
  });

  describe("Bright Daylight grayscale override note", () => {
    it("is hidden when brightDaylight is off", () => {
      render(<VisualsSection />);
      expect(screen.queryByTestId("bright-daylight-grayscale-note")).toBeNull();
    });

    it("is shown when brightDaylight is on and the user has not set a palette", () => {
      h.stateOverrides.brightDaylight = true;
      h.stateOverrides.colormapUserSet = false;
      render(<VisualsSection />);
      const note = screen.getByTestId("bright-daylight-grayscale-note");
      expect(note.textContent).toMatch(/grayscale/i);
      expect(note.textContent).toMatch(/Bright Daylight/i);
    });

    it("is hidden when brightDaylight is on but the user has explicitly chosen a palette", () => {
      h.stateOverrides.brightDaylight = true;
      h.stateOverrides.colormapUserSet = true;
      render(<VisualsSection />);
      expect(screen.queryByTestId("bright-daylight-grayscale-note")).toBeNull();
    });
  });

  describe("intertidal datums card", () => {
    beforeEach(() => {
      useTidalStore.setState({
        station: null,
        stationStatus: "idle",
        datums: null,
        datumsStatus: "idle",
      });
    });

    it("renders the card with MHW/MHHW override inputs", () => {
      render(<VisualsSection />);
      expect(screen.getByTestId("intertidal-datums-card")).toBeInTheDocument();
      expect(screen.getByTestId("intertidal-mhw-override")).toBeInTheDocument();
      expect(screen.getByTestId("intertidal-mhhw-override")).toBeInTheDocument();
    });

    it("shows station datum values and station name in the sublabels", () => {
      useTidalStore.setState({
        station: {
          id: "9452210",
          name: "Juneau, AK",
          lat: 58.3,
          lon: -134.4,
          distanceMiles: 2.1,
        },
        stationStatus: "ready",
        datums: { stationId: "9452210", mhwFt: 14.53, mhhwFt: 15.42 },
        datumsStatus: "ready",
      });
      render(<VisualsSection />);
      expect(screen.getByTestId("intertidal-mhw-override-sublabel").textContent).toMatch(
        /Juneau, AK/,
      );
      expect(screen.getByTestId("intertidal-mhw-override-sublabel").textContent).toMatch(
        /14\.53/,
      );
      expect(screen.getByTestId("intertidal-mhhw-override-sublabel").textContent).toMatch(
        /15\.42/,
      );
      expect(
        (screen.getByTestId("intertidal-mhw-override") as HTMLInputElement).placeholder,
      ).toContain("14.53");
    });

    it("commits a typed override on blur and clears to null on blank blur", () => {
      render(<VisualsSection />);
      const input = screen.getByTestId("intertidal-mhw-override") as HTMLInputElement;

      fireEvent.change(input, { target: { value: "12.5" } });
      fireEvent.blur(input);
      expect(h.setIntertidalMhwOverrideFt).toHaveBeenCalledWith(12.5);

      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(h.setIntertidalMhwOverrideFt).toHaveBeenLastCalledWith(null);
    });
  });
});
