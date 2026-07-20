/**
 * FreshwaterPanel regression tests — guards against the TidePanel crashing or
 * silently hiding content when the backend returns the USGS/GLERL response
 * shape for freshwater locations.
 *
 * Response shape contract is defined by the shared API-server fixtures at:
 *   artifacts/api-server/src/routes/__tests__/fixtures/freshwater-*.json
 *
 * Covered cases:
 *   1. available:false + waterType:"freshwater"  → shows the manual-entry form
 *      with realDataAvailable:false and the data-testid="tide-freshwater-unavailable" node
 *   2. available:true  + source:"usgs"            → shows the manual-entry form
 *      with realDataAvailable:true
 *   3. available:true  + source:"glerl"           → same available:true path
 *   4. available:false + waterType:"saltwater"    → shows the "no station" text
 *      (regression guard: saltwater path must NOT show the freshwater form)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { act } from "react";
import { TidePanel } from "@/components/TidePanel";
import type { TidalDataResult } from "@/hooks/useTidalData";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";
import { usePanelCollapseStore, DEFAULTS as PANEL_DEFAULTS } from "@/lib/panelCollapseStore";
import { renderWithProviders } from "./setup";

vi.mock("@/hooks/useTidalSchedule", () => ({
  useTidalSchedule: vi.fn().mockReturnValue({ schedule: null, isError: false }),
}));

vi.mock("@/lib/context", () => ({
  useAppState: vi.fn().mockReturnValue({
    terrain: { datasetId: "test-dataset" },
    tidalOverlay: null,
    setTidalOverlay: vi.fn(),
  }),
}));

vi.mock("@/components/ManualConditionsForm", () => ({
  ManualConditionsForm: vi.fn(({ realDataAvailable }: { realDataAvailable: boolean }) => (
    <div
      data-testid="manual-conditions-form"
      data-real-data-available={String(realDataAvailable)}
    />
  )),
}));

const UNAVAILABLE: TidalDataResult = { available: false };

const USGS_AVAILABLE: TidalDataResult = {
  available: true,
  tideHeight: 1.2,
  currentDirection: 90,
  currentSpeed: 0.3,
  stationName: "Wisconsin River at Portage, WI",
  stationId: "05407000",
  isPredicted: true,
  source: "usgs",
  heightsSource: "usgs",
  currentsSource: "usgs",
};

const GLERL_AVAILABLE: TidalDataResult = {
  available: true,
  tideHeight: 0.8,
  currentDirection: 45,
  currentSpeed: 0.5,
  stationName: "GLERL Great Lakes Model",
  isPredicted: true,
  source: "glerl",
  heightsSource: "glerl",
  currentsSource: "glerl",
};

function defaultProps(data: TidalDataResult) {
  return {
    data,
    loading: false,
    depthLayer: "surface" as const,
    onDepthLayerChange: vi.fn(),
    scrubDatetime: null,
    onScrubChange: vi.fn(),
    lat: 43.55,
    lon: -89.47,
  };
}

function resetStores(waterType: "saltwater" | "freshwater" = "freshwater") {
  act(() => {
    useSettingsStore.setState({
      ...DEFAULT_SETTINGS,
      waterType,
    });
    usePanelCollapseStore.setState({
      collapsed: { ...PANEL_DEFAULTS, tide: false },
    });
  });
}

describe("TidePanel — freshwater available:false (USGS no-station shape)", () => {
  beforeEach(() => resetStores("freshwater"));

  it("renders the tide-freshwater-unavailable node", () => {
    renderWithProviders(<TidePanel {...defaultProps(UNAVAILABLE)} />);
    expect(screen.getByTestId("tide-freshwater-unavailable")).toBeTruthy();
  });

  it("renders ManualConditionsForm with realDataAvailable:false", () => {
    renderWithProviders(<TidePanel {...defaultProps(UNAVAILABLE)} />);
    const form = screen.getByTestId("manual-conditions-form");
    expect(form.getAttribute("data-real-data-available")).toBe("false");
  });

  it("does not render the saltwater no-station message", () => {
    renderWithProviders(<TidePanel {...defaultProps(UNAVAILABLE)} />);
    expect(
      screen.queryByText(/No tidal station within/i),
    ).toBeNull();
  });
});

describe("TidePanel — freshwater available:true with source:'usgs'", () => {
  beforeEach(() => resetStores("freshwater"));

  it("renders without crashing", () => {
    expect(() => renderWithProviders(<TidePanel {...defaultProps(USGS_AVAILABLE)} />)).not.toThrow();
  });

  it("renders ManualConditionsForm with realDataAvailable:true", () => {
    renderWithProviders(<TidePanel {...defaultProps(USGS_AVAILABLE)} />);
    const form = screen.getByTestId("manual-conditions-form");
    expect(form.getAttribute("data-real-data-available")).toBe("true");
  });

  it("does not render the freshwater-unavailable node", () => {
    renderWithProviders(<TidePanel {...defaultProps(USGS_AVAILABLE)} />);
    expect(screen.queryByTestId("tide-freshwater-unavailable")).toBeNull();
  });
});

describe("TidePanel — freshwater available:true with source:'glerl'", () => {
  beforeEach(() => resetStores("freshwater"));

  it("renders without crashing", () => {
    expect(() => renderWithProviders(<TidePanel {...defaultProps(GLERL_AVAILABLE)} />)).not.toThrow();
  });

  it("renders ManualConditionsForm with realDataAvailable:true", () => {
    renderWithProviders(<TidePanel {...defaultProps(GLERL_AVAILABLE)} />);
    const form = screen.getByTestId("manual-conditions-form");
    expect(form.getAttribute("data-real-data-available")).toBe("true");
  });
});

describe("TidePanel — saltwater available:false (regression guard)", () => {
  beforeEach(() => resetStores("saltwater"));

  it("shows the saltwater no-station message — NOT the freshwater form", () => {
    renderWithProviders(<TidePanel {...defaultProps(UNAVAILABLE)} />);
    expect(screen.queryByTestId("tide-freshwater-unavailable")).toBeNull();
    expect(screen.queryByTestId("manual-conditions-form")).toBeNull();
    expect(screen.getByText(/No tidal station within/i)).toBeTruthy();
  });
});
