/**
 * ChartMapSection.mobile.test.tsx
 *
 * Regression guard for the mobile-only "2D Chart" Settings section (task #4040).
 *
 * Covers two key failure modes:
 *   (a) Mobile loses access to a chart option — relocated row hidden in its old
 *       spot but missing from the new section, or the new tab not rendering.
 *   (b) Desktop Settings changes — "chart-map" tab leaking into the desktop tab
 *       strip, or the contour / grid-markers rows disappearing from their original
 *       sections on desktop.
 *
 * Test structure:
 *   1. ChartMapSection (direct render) — verifies all controls render and each
 *      one dispatches to the correct settings-store setter.
 *   2. DepthColorsCard — contour rows absent on mobile, present on desktop.
 *   3. DisplayOverlaysSection — grid/markers toggles absent on mobile, present
 *      on desktop.
 *   4. constants — MOBILE_NAV_TABS includes "chart-map"; NAV_TABS does not.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ─── Mock useIsMobile so each describe block can control the value ────────────
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
}));

// ─── Hoisted mock primitives shared across all component mocks ────────────────
const h = vi.hoisted(() => {
  const setContoursEnabled = vi.fn();
  const setContourInterval = vi.fn();
  const setContourDensity = vi.fn();
  const setOverviewShowGrid = vi.fn();
  const setOverviewShowMarkers = vi.fn();
  const stateOverrides: Record<string, unknown> = {};
  return {
    setContoursEnabled,
    setContourInterval,
    setContourDensity,
    setOverviewShowGrid,
    setOverviewShowMarkers,
    stateOverrides,
  };
});

// ─── settingsStore mock ───────────────────────────────────────────────────────
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const state = () => ({
    contoursEnabled: false,
    setContoursEnabled: h.setContoursEnabled,
    contourInterval: 10,
    setContourInterval: h.setContourInterval,
    contourDensity: 1,
    setContourDensity: h.setContourDensity,
    overviewShowGrid: true,
    setOverviewShowGrid: h.setOverviewShowGrid,
    overviewShowMarkers: true,
    setOverviewShowMarkers: h.setOverviewShowMarkers,
    units: "imperial" as const,
    // DepthColorsCard / DisplayOverlaysSection extras
    colormapTheme: "ocean" as const,
    setColormapThemeByUser: vi.fn(),
    setColormapTheme: vi.fn(),
    brightDaylight: false,
    colormapUserSet: false,
    nodataColor: "#bfbfbf",
    setNodataColor: vi.fn(),
    coordinateFormat: "decimal" as const,
    setCoordinateFormat: vi.fn(),
    hudOpacity: 1,
    setHudOpacity: vi.fn(),
    overviewOpenOnLoad: false,
    setOverviewOpenOnLoad: vi.fn(),
    overviewDefaultZoom: 1,
    setOverviewDefaultZoom: vi.fn(),
    showCrosshairGps: true,
    setShowCrosshairGps: vi.fn(),
    showCameraPosition: true,
    setShowCameraPosition: vi.fn(),
    showHeading: true,
    setShowHeading: vi.fn(),
    showDepthLegend: true,
    setShowDepthLegend: vi.fn(),
    showDepthScaleBar: true,
    setShowDepthScaleBar: vi.fn(),
    showCompassMinimap: true,
    setShowCompassMinimap: vi.fn(),
    showControlsLegend: true,
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
    autoShowZoneOverlay: false,
    setAutoShowZoneOverlay: vi.fn(),
    habitatOverlayIntensity: 0.5,
    setHabitatOverlayIntensity: vi.fn(),
    defaultHabitatSpecies: "",
    setDefaultHabitatSpecies: vi.fn(),
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

// ─── paletteStore stub (for DepthColorsCard) ─────────────────────────────────
vi.mock("@/lib/paletteStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paletteStore")>();
  const state = () => ({
    shallow: "#001a33",
    deep: "#00bcd4",
    bandColors: ["#001a33", "#0077cc", "#00bcd4"],
    bandBoundaries: [0, 50, 100],
    blendBands: false,
    savedDepthThemes: [],
    reset: vi.fn(),
    setBandColors: vi.fn(),
    setBandBoundaries: vi.fn(),
    setBlendBands: vi.fn(),
    setShallow: vi.fn(),
    setDeep: vi.fn(),
    saveCurrentTheme: vi.fn(),
    deleteTheme: vi.fn(),
    renameTheme: vi.fn(),
    applyTheme: vi.fn(),
  });
  const usePaletteStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    { getState: () => state(), setState: vi.fn(), subscribe: () => () => {} },
  );
  return { ...actual, usePaletteStore };
});

// ─── Stubs for heavy sub-components ──────────────────────────────────────────
vi.mock("@/lib/colormap", () => ({
  colormapCanvas: () => {
    const c = document.createElement("canvas");
    c.width = 14;
    c.height = 240;
    return c;
  },
}));
vi.mock("@/lib/units", () => ({ formatDepth: (v: number) => `${v} ft` }));
vi.mock("@/hooks/useServerSettingsSync", () => ({
  flushServerSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/settingsGuards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsGuards")>();
  return { ...actual };
});
vi.mock("@/lib/useIntertidal", () => ({
  useIntertidal: () => ({ stationName: null, datumsStatus: "idle", stationMhwFt: null, stationMhhwFt: null }),
}));
vi.mock("@/lib/uiStore", () => ({
  useUiStore: vi.fn(() => vi.fn()),
}));
vi.mock("@/components/AdvancedDisclosure", () => ({
  AdvancedDisclosure: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/pages/settings/components/ZoneColourSwatches", () => ({
  ZoneColourSwatches: () => <div data-testid="zone-colour-swatches" />,
}));
vi.mock("@/pages/settings/components/SectionTitle", () => ({
  SectionTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/pages/settings/components/SyncContext", () => ({
  SectionActionsRow: () => <div />,
}));

// Stub RowWidgets — interaction tests need prop-wiring, not real sliders.
vi.mock("@/pages/settings/components/RowWidgets", () => ({
  SliderRow: ({
    label,
    disabled,
  }: {
    label: string;
    disabled?: boolean;
  }) => (
    <div data-testid={`sliderrow-${label}`} data-disabled={disabled ? "true" : "false"}>
      {label}
    </div>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <button type="button" data-testid={`togglerow-${label}`} onClick={() => onChange(!value)}>
      {label}
    </button>
  ),
  SelectRow: ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      data-testid={`selectrow-${label}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  ColorRow: ({ label }: { label: string }) => <div>{label}</div>,
  ColormapSelectRow: ({ label }: { label: string }) => <div>{label}</div>,
  clampSlider: (v: number, min: number, max: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback,
}));

vi.mock("../styles", () => ({
  S: new Proxy({} as Record<string, React.CSSProperties>, { get: () => ({}) }),
  FONT: "monospace",
}));
vi.mock("../constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../constants")>();
  return {
    ...actual,
    defaultContourInterval: (units: string) => (units === "imperial" ? 50 : 10),
  };
});

// ─── Imports under test ───────────────────────────────────────────────────────
import { useIsMobile } from "@/hooks/use-mobile";
import { ChartMapSection } from "../ChartMapSection";
import { DepthColorsCard } from "../components/DepthColorsCard";
import { DisplayOverlaysSection } from "../DisplayOverlaysSection";
import { NAV_TABS, MOBILE_NAV_TABS } from "../constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  h.setContoursEnabled.mockClear();
  h.setContourInterval.mockClear();
  h.setContourDensity.mockClear();
  h.setOverviewShowGrid.mockClear();
  h.setOverviewShowMarkers.mockClear();
  for (const k of Object.keys(h.stateOverrides)) delete h.stateOverrides[k];
  vi.mocked(useIsMobile).mockReturnValue(false);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ChartMapSection — all controls render and dispatch to the correct setters
// ═══════════════════════════════════════════════════════════════════════════════
describe("ChartMapSection — control rendering and store wiring", () => {
  it("renders the Show Contour Lines toggle", () => {
    render(<ChartMapSection />);
    expect(screen.getByTestId("togglerow-Show Contour Lines")).toBeInTheDocument();
  });

  it("renders the Contour Interval slider", () => {
    render(<ChartMapSection />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toBeInTheDocument();
  });

  it("renders the Contour Density selector", () => {
    render(<ChartMapSection />);
    expect(screen.getByTestId("selectrow-Contour Density")).toBeInTheDocument();
  });

  it("renders the Show Grid Lines toggle", () => {
    render(<ChartMapSection />);
    expect(screen.getByTestId("togglerow-Show Grid Lines")).toBeInTheDocument();
  });

  it("renders the Show Markers toggle", () => {
    render(<ChartMapSection />);
    expect(screen.getByTestId("togglerow-Show Markers")).toBeInTheDocument();
  });

  it("dispatches to setContoursEnabled when the contours toggle is clicked", () => {
    render(<ChartMapSection />);
    fireEvent.click(screen.getByTestId("togglerow-Show Contour Lines"));
    // default state has contoursEnabled:false → click passes true
    expect(h.setContoursEnabled).toHaveBeenCalledWith(true);
  });

  it("dispatches to setOverviewShowGrid when the grid toggle is clicked", () => {
    h.stateOverrides.overviewShowGrid = true;
    render(<ChartMapSection />);
    fireEvent.click(screen.getByTestId("togglerow-Show Grid Lines"));
    expect(h.setOverviewShowGrid).toHaveBeenCalledWith(false);
  });

  it("dispatches to setOverviewShowMarkers when the markers toggle is clicked", () => {
    h.stateOverrides.overviewShowMarkers = true;
    render(<ChartMapSection />);
    fireEvent.click(screen.getByTestId("togglerow-Show Markers"));
    expect(h.setOverviewShowMarkers).toHaveBeenCalledWith(false);
  });

  it("dispatches to setContourDensity when the density select changes", () => {
    render(<ChartMapSection />);
    fireEvent.change(screen.getByTestId("selectrow-Contour Density"), {
      target: { value: "2" },
    });
    expect(h.setContourDensity).toHaveBeenCalledWith(2);
  });

  it("disables the Contour Interval slider when contoursEnabled is false", () => {
    // Default state has contoursEnabled:false
    render(<ChartMapSection />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });

  it("enables the Contour Interval slider when contoursEnabled is true", () => {
    h.stateOverrides.contoursEnabled = true;
    render(<ChartMapSection />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toHaveAttribute(
      "data-disabled",
      "false",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DepthColorsCard — contour rows hidden on mobile, present on desktop
// ═══════════════════════════════════════════════════════════════════════════════
describe("DepthColorsCard — contour rows on mobile vs desktop", () => {
  it("hides the Show Contour Lines toggle on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<DepthColorsCard />);
    expect(screen.queryByTestId("togglerow-Show Contour Lines")).toBeNull();
  });

  it("hides the Contour Interval slider on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<DepthColorsCard />);
    expect(screen.queryByTestId("sliderrow-Contour Interval")).toBeNull();
  });

  it("renders the Show Contour Lines toggle on desktop", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<DepthColorsCard />);
    expect(screen.getByTestId("togglerow-Show Contour Lines")).toBeInTheDocument();
  });

  it("renders the Contour Interval slider on desktop", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<DepthColorsCard />);
    expect(screen.getByTestId("sliderrow-Contour Interval")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DisplayOverlaysSection — grid/markers toggles hidden on mobile, on desktop
// ═══════════════════════════════════════════════════════════════════════════════
describe("DisplayOverlaysSection — grid and markers toggles on mobile vs desktop", () => {
  it("hides Show Grid Lines on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<DisplayOverlaysSection />);
    expect(screen.queryByTestId("togglerow-Show Grid Lines")).toBeNull();
  });

  it("hides Show Markers on mobile", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<DisplayOverlaysSection />);
    expect(screen.queryByTestId("togglerow-Show Markers")).toBeNull();
  });

  it("renders Show Grid Lines on desktop", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<DisplayOverlaysSection />);
    expect(screen.getByTestId("togglerow-Show Grid Lines")).toBeInTheDocument();
  });

  it("renders Show Markers on desktop", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<DisplayOverlaysSection />);
    expect(screen.getByTestId("togglerow-Show Markers")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Tab-strip constants — chart-map in mobile only
// ═══════════════════════════════════════════════════════════════════════════════
describe("NAV_TABS / MOBILE_NAV_TABS constant correctness", () => {
  it("NAV_TABS contains exactly 10 desktop tabs and no chart-map entry", () => {
    expect(NAV_TABS).toHaveLength(10);
    expect(NAV_TABS.find((t) => t.id === "chart-map")).toBeUndefined();
  });

  it("MOBILE_NAV_TABS contains the chart-map tab", () => {
    expect(MOBILE_NAV_TABS.find((t) => t.id === "chart-map")).toBeDefined();
  });

  it("MOBILE_NAV_TABS contains all 10 desktop tabs in addition to chart-map", () => {
    const desktopIds = NAV_TABS.map((t) => t.id);
    for (const id of desktopIds) {
      expect(MOBILE_NAV_TABS.find((t) => t.id === id)).toBeDefined();
    }
  });

  it("MOBILE_NAV_TABS has chart-map near the top (within the first 3 entries)", () => {
    const idx = MOBILE_NAV_TABS.findIndex((t) => t.id === "chart-map");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(2);
  });
});
