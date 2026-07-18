/**
 * Unit tests for ZoneLegendChip.
 *
 * Covers:
 * - Chip is hidden when overlay is off or no zone map loaded.
 * - Chip renders when overlay is on + zone map present.
 * - Collapsed by default; click expands; click again collapses.
 * - Saltwater zone labels are shown when expanded.
 * - Freshwater zone labels are shown when the terrain water type is freshwater.
 * - Custom slot colors are reflected in swatch backgrounds.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Store mocks — set up before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

const uiState = { zoneOverlayEnabled: true };
vi.mock("@/lib/uiStore", () => ({
  useUiStore: (sel: (s: typeof uiState) => unknown) => sel(uiState),
}));

const classificationState: { zoneMap: Uint8Array<ArrayBuffer> | null } = {
  zoneMap: new Uint8Array(new ArrayBuffer(256 * 256)),
};
vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: (sel: (s: typeof classificationState) => unknown) =>
    sel(classificationState),
}));

const overlayState = {
  slots: [
    { color: "#f5d58a", visible: true },
    { color: "#c49a6c", visible: true },
    { color: "#8ab4d0", visible: true },
    { color: "#b06060", visible: true },
  ] as [
    { color: string; visible: boolean },
    { color: string; visible: boolean },
    { color: string; visible: boolean },
    { color: string; visible: boolean },
  ],
  setActiveWaterType: vi.fn(),
};
vi.mock("@/lib/zoneOverlayStore", () => ({
  useZoneOverlayStore: (sel: (s: typeof overlayState) => unknown) => sel(overlayState),
}));

const appStateValue = { terrain: { waterType: "saltwater", datasetId: "ds-1" } };
vi.mock("@/lib/context", () => ({
  useAppState: () => appStateValue,
}));

const toggleMock = vi.fn();
const panelState = {
  collapsed: { zoneLegendChip: true } as Record<string, boolean>,
  toggle: toggleMock,
  setCollapsed: vi.fn(),
};
vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (sel: (s: typeof panelState) => unknown) => sel(panelState),
}));

// ---------------------------------------------------------------------------
// CSS mock (jsdom doesn't process CSS files)
// ---------------------------------------------------------------------------
vi.mock("@/components/help/help.css", () => ({}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import { ZoneLegendChip } from "@/components/help/ZoneLegendChip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderChip() {
  return render(<ZoneLegendChip />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ZoneLegendChip", () => {
  beforeEach(() => {
    uiState.zoneOverlayEnabled = true;
    classificationState.zoneMap = new Uint8Array(new ArrayBuffer(256 * 256));
    appStateValue.terrain = { waterType: "saltwater", datasetId: "ds-1" };
    overlayState.slots = [
      { color: "#f5d58a", visible: true },
      { color: "#c49a6c", visible: true },
      { color: "#8ab4d0", visible: true },
      { color: "#b06060", visible: true },
    ];
    panelState.collapsed = { zoneLegendChip: true };
    toggleMock.mockClear();
    overlayState.setActiveWaterType.mockClear();
  });

  it("renders nothing when overlay is disabled", () => {
    uiState.zoneOverlayEnabled = false;
    renderChip();
    expect(screen.queryByTestId("zone-legend-chip")).toBeNull();
  });

  it("renders nothing when no zone map is loaded", () => {
    classificationState.zoneMap = null;
    renderChip();
    expect(screen.queryByTestId("zone-legend-chip")).toBeNull();
  });

  it("renders nothing when terrain is absent", () => {
    appStateValue.terrain = null as unknown as typeof appStateValue.terrain;
    renderChip();
    expect(screen.queryByTestId("zone-legend-chip")).toBeNull();
  });

  it("renders the chip when overlay is on and zone map is loaded", () => {
    renderChip();
    expect(screen.getByTestId("zone-legend-chip")).toBeTruthy();
  });

  it("shows ZONES label in collapsed state", () => {
    renderChip();
    expect(screen.getByText("ZONES")).toBeTruthy();
  });

  it("is collapsed by default (no list visible)", () => {
    renderChip();
    expect(screen.queryByTestId("zone-legend-chip-list")).toBeNull();
  });

  it("calls toggle when the chip header is clicked", () => {
    renderChip();
    fireEvent.click(screen.getByTestId("zone-legend-chip-toggle"));
    expect(toggleMock).toHaveBeenCalledWith("zoneLegendChip");
  });

  it("shows zone list when expanded (saltwater)", () => {
    panelState.collapsed = { zoneLegendChip: false };
    renderChip();
    expect(screen.getByTestId("zone-legend-chip-list")).toBeTruthy();
    // Saltwater zone labels formatted from snake_case
    expect(screen.getByText("sandy shelf")).toBeTruthy();
    expect(screen.getByText("coral reef potential")).toBeTruthy();
    expect(screen.getByText("trench wall")).toBeTruthy();
    expect(screen.getByText("basalt rock")).toBeTruthy();
  });

  it("shows freshwater zone labels when terrain is freshwater", () => {
    appStateValue.terrain = { waterType: "freshwater", datasetId: "ds-fw" };
    panelState.collapsed = { zoneLegendChip: false };
    renderChip();
    expect(screen.getByText("aquatic vegetation")).toBeTruthy();
    expect(screen.getByText("sandy lake bed")).toBeTruthy();
    expect(screen.getByText("clay flat")).toBeTruthy();
    expect(screen.getByText("gravel bed")).toBeTruthy();
  });

  it("reflects custom slot colors in expanded swatches", () => {
    overlayState.slots = [
      { color: "#ff0000", visible: true },
      { color: "#00ff00", visible: true },
      { color: "#0000ff", visible: true },
      { color: "#ffffff", visible: true },
    ];
    panelState.collapsed = { zoneLegendChip: false };
    renderChip();

    // sandy_shelf maps to slot 0 → #ff0000
    const sandyRow = screen.getByTestId("zone-legend-row-sandy_shelf");
    const swatch = sandyRow.querySelector(".zone-legend-chip-swatch");
    expect(swatch).toBeTruthy();
    expect((swatch as HTMLElement).style.background).toBe("rgb(255, 0, 0)");
  });

  it("shows freshwater custom colors for the correct slot mapping", () => {
    appStateValue.terrain = { waterType: "freshwater", datasetId: "ds-fw" };
    overlayState.slots = [
      { color: "#aabbcc", visible: true }, // slot 0
      { color: "#112233", visible: true }, // slot 1
      { color: "#445566", visible: true }, // slot 2
      { color: "#778899", visible: true }, // slot 3
    ];
    panelState.collapsed = { zoneLegendChip: false };
    renderChip();

    // aquatic_vegetation → FRESHWATER_ZONE_TO_SLOT[0] = slot 0 → #aabbcc
    const vegRow = screen.getByTestId("zone-legend-row-aquatic_vegetation");
    const swatch = vegRow.querySelector(".zone-legend-chip-swatch");
    expect(swatch).toBeTruthy();
    expect((swatch as HTMLElement).style.background).toMatch(/rgb\(170,\s*187,\s*204\)/);
  });

  it("calls setActiveWaterType with terrain water type on mount", () => {
    renderChip();
    expect(overlayState.setActiveWaterType).toHaveBeenCalledWith("saltwater");
  });
});
