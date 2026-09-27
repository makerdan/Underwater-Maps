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
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  const setDefaultHabitatSpecies = vi.fn();
  const efhSpeciesPreferences: Record<string, string[]> = {};
  const clearEfhSpeciesPreference = vi.fn((datasetId: string) => {
    delete efhSpeciesPreferences[datasetId];
  });
  return {
    resetSection,
    setDefaultHabitatSpecies,
    efhSpeciesPreferences,
    clearEfhSpeciesPreference,
  };
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
    setDefaultHabitatSpecies: h.setDefaultHabitatSpecies,
    efhSpeciesPreferences: h.efhSpeciesPreferences,
    clearEfhSpeciesPreference: h.clearEfhSpeciesPreference,
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
    h.setDefaultHabitatSpecies.mockClear();
    h.clearEfhSpeciesPreference.mockClear();
    for (const datasetId of Object.keys(h.efhSpeciesPreferences)) {
      delete h.efhSpeciesPreferences[datasetId];
    }
  });

  it("renders without crashing", () => {
    const { container } = render(<DisplayOverlaysSection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the DISPLAY & OVERLAYS heading text", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByRole("heading", { name: /DISPLAY & OVERLAYS/i })).toBeInTheDocument();
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

  it("lists remembered EFH pairs by dataset and clears only the selected pair", () => {
    h.efhSpeciesPreferences["dataset-a"] = ["Pacific Halibut", "Pacific Cod"];
    h.efhSpeciesPreferences["dataset-b"] = ["Sablefish"];
    const view = render(<DisplayOverlaysSection />);

    expect(screen.getByText("Pacific Halibut · Pacific Cod")).toBeInTheDocument();
    expect(screen.getByText("Sablefish")).toBeInTheDocument();
    expect(screen.getByTestId("efh-preference-dataset-dataset-a")).toHaveTextContent("dataset-a");
    expect(screen.getByTestId("efh-preference-dataset-dataset-b")).toHaveTextContent("dataset-b");

    fireEvent.click(screen.getByRole("button", {
      name: "Forget saved EFH pair for dataset dataset-a",
    }));

    expect(h.clearEfhSpeciesPreference).toHaveBeenCalledExactlyOnceWith("dataset-a");
    view.rerender(<DisplayOverlaysSection />);
    expect(screen.queryByTestId("efh-preference-row-dataset-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("efh-preference-row-dataset-b")).toBeInTheDocument();
  });

  it("shows an empty state when no remembered EFH pairs exist", () => {
    render(<DisplayOverlaysSection />);
    expect(screen.getByTestId("remembered-efh-pairs-empty")).toHaveTextContent(
      "No remembered EFH pairs.",
    );
  });

  describe("accessibility semantics", () => {
    it("getByLabelText('Default Species') resolves to the text input", () => {
      render(<DisplayOverlaysSection />);
      const input = screen.getByLabelText("Default Species");
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "text");
      expect(input).toHaveAttribute("id", "settings-default-species-input");
    });

    it.each([
      "HUD & LAYOUT",
      "VISIBILITY",
      "FORMAT & DISPLAY",
      "PANELS",
      "TIME FORMAT",
      "MAP & OVERLAYS",
      "OVERVIEW MAP",
      "HABITAT",
      "HABITAT DEFAULTS",
    ])("card header '%s' is a level-3 heading", (name) => {
      render(<DisplayOverlaysSection />);
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    });
  });

  // Regression: group headings live inside the first control card — no
  // standalone header-only ("empty") cards.
  it("HUD & LAYOUT heading shares a card with the VISIBILITY controls (no empty card)", () => {
    render(<DisplayOverlaysSection />);
    const groupHeading = screen.getByText("HUD & LAYOUT");
    const cardHeader = screen.getByText("VISIBILITY");
    expect(groupHeading.parentElement).toBe(cardHeader.parentElement);
    expect(groupHeading.parentElement!.children.length).toBeGreaterThan(1);
  });

  it("MAP & OVERLAYS heading shares a card with the OVERVIEW MAP controls (no empty card)", () => {
    render(<DisplayOverlaysSection />);
    const groupHeading = screen.getByText("MAP & OVERLAYS");
    const cardHeader = screen.getByText("OVERVIEW MAP");
    expect(groupHeading.parentElement).toBe(cardHeader.parentElement);
    expect(groupHeading.parentElement!.children.length).toBeGreaterThan(1);
  });

  describe("Default Species input constraints", () => {
    it("has maxLength 120 and a format-hint placeholder", () => {
      render(<DisplayOverlaysSection />);
      const input = screen.getByPlaceholderText("e.g. Oncorhynchus mykiss");
      expect(input).toHaveAttribute("maxLength", "120");
    });

    it("stores a whitespace-only value as an empty string on blur", () => {
      render(<DisplayOverlaysSection />);
      const input = screen.getByPlaceholderText("e.g. Oncorhynchus mykiss");
      fireEvent.blur(input, { target: { value: "   " } });
      expect(h.setDefaultHabitatSpecies).toHaveBeenCalledWith("");
    });

    it("trims surrounding whitespace on blur", () => {
      render(<DisplayOverlaysSection />);
      const input = screen.getByPlaceholderText("e.g. Oncorhynchus mykiss");
      fireEvent.blur(input, { target: { value: "  Oncorhynchus mykiss  " } });
      expect(h.setDefaultHabitatSpecies).toHaveBeenCalledWith("Oncorhynchus mykiss");
    });

    it("does not call the setter on blur when the value is already trimmed", () => {
      render(<DisplayOverlaysSection />);
      const input = screen.getByPlaceholderText("e.g. Oncorhynchus mykiss");
      fireEvent.blur(input, { target: { value: "Salmo trutta" } });
      expect(h.setDefaultHabitatSpecies).not.toHaveBeenCalled();
    });
  });
});
