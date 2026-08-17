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
  const setMaxActiveDatasets = vi.fn();
  const setProximityMode = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  return { resetSection, setIntertidalMhwOverrideFt, setIntertidalMhhwOverrideFt, setMaxActiveDatasets, setProximityMode, stateOverrides };
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
    setIntertidalMhwOverrideFt: h.setIntertidalMhwOverrideFt,
    setIntertidalMhhwOverrideFt: h.setIntertidalMhhwOverrideFt,
    brightDaylight: false,
    colormapUserSet: false,
    maxActiveDatasets: 3,
    setMaxActiveDatasets: h.setMaxActiveDatasets,
    proximityMode: true,
    setProximityMode: h.setProximityMode,
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

vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

import { VisualsSection } from "../VisualsSection";
import { useTidalStore } from "@/lib/tidalStore";
import { useUiStore } from "@/lib/uiStore";

describe("VisualsSection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    h.setMaxActiveDatasets.mockClear();
    h.setProximityMode.mockClear();
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

  it("renders Show survey-gap boundary rings toggle inside the AdvancedDisclosure wrapper", () => {
    render(<VisualsSection />);
    const advanced = screen.getByTestId("advanced-disclosure");
    const { getByText } = within(advanced);
    expect(getByText("Show survey-gap boundary rings")).toBeInTheDocument();
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

  it("renders the PERFORMANCE card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("PERFORMANCE")).toBeInTheDocument();
  });

  it("renders the Max active datasets label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Max active datasets")).toBeInTheDocument();
  });

  it("renders the Max active datasets select with options 1–6", () => {
    render(<VisualsSection />);
    // SelectRow renders a <select> with the options
    const selects = screen.getAllByRole("combobox");
    // Find the one for max active datasets by looking for options 1–6
    const maxDsSelect = selects.find((s) => {
      const opts = Array.from(s.querySelectorAll("option")).map((o) => o.value);
      return opts.includes("1") && opts.includes("6");
    });
    expect(maxDsSelect).toBeDefined();
    const optValues = Array.from(maxDsSelect!.querySelectorAll("option")).map((o) => o.value);
    expect(optValues).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("reflects the current maxActiveDatasets value in the select", () => {
    h.stateOverrides.maxActiveDatasets = 4;
    render(<VisualsSection />);
    const selects = screen.getAllByRole("combobox");
    const maxDsSelect = selects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => o.value === "6"),
    );
    expect(maxDsSelect).toBeDefined();
    expect((maxDsSelect as HTMLSelectElement).value).toBe("4");
  });

  it("calls setMaxActiveDatasets when the select changes", () => {
    render(<VisualsSection />);
    const selects = screen.getAllByRole("combobox");
    const maxDsSelect = selects.find((s) =>
      Array.from(s.querySelectorAll("option")).some((o) => o.value === "6"),
    );
    expect(maxDsSelect).toBeDefined();
    fireEvent.change(maxDsSelect!, { target: { value: "5" } });
    expect(h.setMaxActiveDatasets).toHaveBeenCalledWith(5);
  });

  it("renders nested EFFECTS card header", () => {
    render(<VisualsSection />);
    expect(screen.getByText("EFFECTS")).toBeInTheDocument();
  });

  it("renders the Antialiasing label", () => {
    render(<VisualsSection />);
    expect(screen.getByText("Antialiasing")).toBeInTheDocument();
  });

  describe("antialiasing reload hint", () => {
    it("is hidden when antialiasing matches the value active at page load", () => {
      render(<VisualsSection />);
      expect(screen.queryByTestId("antialiasing-reload-hint")).toBeNull();
    });

    it("appears when antialiasing changes from its page-load value", () => {
      const { rerender } = render(<VisualsSection />);
      expect(screen.queryByTestId("antialiasing-reload-hint")).toBeNull();
      h.stateOverrides.antialiasing = false; // mount captured `true`
      rerender(<VisualsSection />);
      const hint = screen.getByTestId("antialiasing-reload-hint");
      expect(hint.textContent).toMatch(/takes effect after reload/i);
    });

    it("hides again when antialiasing is toggled back to the page-load value", () => {
      const { rerender } = render(<VisualsSection />);
      h.stateOverrides.antialiasing = false;
      rerender(<VisualsSection />);
      expect(screen.getByTestId("antialiasing-reload-hint")).toBeInTheDocument();
      delete h.stateOverrides.antialiasing; // back to true
      rerender(<VisualsSection />);
      expect(screen.queryByTestId("antialiasing-reload-hint")).toBeNull();
    });
  });

  describe("mount repair of invalid persisted values", () => {
    it("repairs a null maxActiveDatasets to the default", () => {
      h.stateOverrides.maxActiveDatasets = null;
      render(<VisualsSection />);
      expect(h.setMaxActiveDatasets).toHaveBeenCalledWith(3);
    });

    it("repairs an out-of-range maxActiveDatasets to the default", () => {
      h.stateOverrides.maxActiveDatasets = 99;
      render(<VisualsSection />);
      expect(h.setMaxActiveDatasets).toHaveBeenCalledWith(3);
    });

    it("repairs a non-numeric maxActiveDatasets to the default", () => {
      h.stateOverrides.maxActiveDatasets = "4";
      render(<VisualsSection />);
      expect(h.setMaxActiveDatasets).toHaveBeenCalledWith(3);
    });

    it("leaves a valid maxActiveDatasets untouched", () => {
      h.stateOverrides.maxActiveDatasets = 5;
      render(<VisualsSection />);
      expect(h.setMaxActiveDatasets).not.toHaveBeenCalled();
    });

    it("repairs a null proximityMode to the default (true)", () => {
      h.stateOverrides.proximityMode = null;
      render(<VisualsSection />);
      expect(h.setProximityMode).toHaveBeenCalledWith(true);
    });

    it("leaves a valid proximityMode untouched", () => {
      h.stateOverrides.proximityMode = false;
      render(<VisualsSection />);
      expect(h.setProximityMode).not.toHaveBeenCalled();
    });
  });

  describe("showNodataBoundary — Settings toggle keeps uiStore in sync", () => {
    beforeEach(() => {
      // Ensure uiStore starts at the known default (true) before each sync test.
      useUiStore.setState({ showNodataBoundary: true });
    });

    it("clicking the toggle from ON→OFF updates uiStore.showNodataBoundary to false", () => {
      // The mocked settingsStore returns showNodataBoundary: true (see mock above).
      // VisualsSection now calls the uiStore setter on toggle so the 3D scene
      // (which reads uiStore) stays in sync with the Settings panel.
      render(<VisualsSection />);
      const toggle = screen.getByRole("switch", { name: "Show survey-gap boundary rings" });
      fireEvent.click(toggle);
      expect(useUiStore.getState().showNodataBoundary).toBe(false);
    });

    it("clicking the toggle from OFF→ON updates uiStore.showNodataBoundary to true", () => {
      // Prime both stores to false so the mock reports the toggle as off.
      useUiStore.setState({ showNodataBoundary: false });
      h.stateOverrides.showNodataBoundary = false;
      render(<VisualsSection />);
      const toggle = screen.getByRole("switch", { name: "Show survey-gap boundary rings" });
      fireEvent.click(toggle);
      expect(useUiStore.getState().showNodataBoundary).toBe(true);
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
