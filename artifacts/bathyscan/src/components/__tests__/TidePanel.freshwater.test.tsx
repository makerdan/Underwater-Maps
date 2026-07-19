/**
 * TidePanel — freshwater-mode unit tests.
 *
 * Verifies:
 *   1. freshwater + available:false shows "No water level data for this location."
 *   2. freshwater + available:true shows "Water Level" label (not "Tide height").
 *   3. freshwater + available:true shows DataSourceBadge (data-source="usgs").
 *   4. freshwater + available:true shows DataSourceBadge (data-source="glerl").
 *   5. saltwater + available:false still shows "No tidal station within…" (regression).
 *   6. saltwater + available:true still shows "Tide height" label (regression).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TidalDataResult } from "@/hooks/useTidalData";

// ── vi.hoisted: values visible before mock factories run ─────────────────────

const h = vi.hoisted(() => {
  let waterType: "saltwater" | "freshwater" = "saltwater";
  return {
    get waterType() { return waterType; },
    set waterType(v) { waterType = v; },
  };
});

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (sel: (s: { collapsed: { tide: boolean }; toggle: () => void }) => unknown) =>
    sel({ collapsed: { tide: false }, toggle: vi.fn() }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = () => ({
    ...actual.DEFAULT_SETTINGS,
    units: "metric" as const,
    defaultTidalDepthLayer: "surface" as const,
    waterType: h.waterType,
  });
  const useSettingsStore = Object.assign(
    (sel: (s: ReturnType<typeof storeState>) => unknown) => sel(storeState()),
    {
      getState: storeState,
      setState: vi.fn(),
      subscribe: () => () => {},
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
    },
  );
  return { ...actual, useSettingsStore };
});

vi.mock("@/hooks/useTidalSchedule", () => ({
  useTidalSchedule: () => ({ schedule: null }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

// ── Shared helpers ────────────────────────────────────────────────────────────

const UNAVAILABLE: TidalDataResult = { available: false };

function makeAvailable(
  source: "noaa" | "usgs" | "glerl" | "estimated" = "noaa",
  stationId = "MOCK01",
): TidalDataResult {
  return {
    available: true,
    tideHeight: 2.1,
    currentDirection: 90,
    currentSpeed: 0.3,
    stationName: "Mock Station",
    stationId,
    isPredicted: false,
    source,
  };
}

function renderPanel(data: TidalDataResult) {
  return render(
    React.createElement(
      React.Suspense,
      { fallback: null },
      React.createElement(
        (async () => {
          const { TidePanel } = await import("@/components/TidePanel");
          return TidePanel;
        })() as unknown as React.ComponentType<Record<string, unknown>>,
        {
          data,
          loading: false,
          depthLayer: "surface",
          onDepthLayerChange: vi.fn(),
          scrubDatetime: null,
          onScrubChange: vi.fn(),
          lat: 44.0,
          lon: -87.5,
          embedded: true,
        },
      ),
    ),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TidePanel — freshwater empty state", () => {
  beforeEach(() => {
    h.waterType = "saltwater";
  });

  it("freshwater + unavailable: shows freshwater-specific message", async () => {
    h.waterType = "freshwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={UNAVAILABLE}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={44.0}
        lon={-87.5}
        embedded
      />,
    );
    expect(screen.getByTestId("tide-freshwater-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("tide-freshwater-unavailable")).toHaveTextContent(
      "No water level data for this location.",
    );
  });

  it("freshwater + unavailable: does NOT show saltwater tidal station message", async () => {
    h.waterType = "freshwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={UNAVAILABLE}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={44.0}
        lon={-87.5}
        embedded
      />,
    );
    expect(screen.queryByText(/tidal station within/i)).toBeNull();
  });

  it("freshwater + available: shows 'Water Level' label instead of 'Tide height'", async () => {
    h.waterType = "freshwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={makeAvailable("usgs", "04082500")}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={44.0}
        lon={-87.5}
        embedded
      />,
    );
    expect(screen.getByText(/water level/i)).toBeInTheDocument();
    expect(screen.queryByText(/tide height/i)).toBeNull();
  });

  it("freshwater + usgs source: DataSourceBadge shows USGS", async () => {
    h.waterType = "freshwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={makeAvailable("usgs", "04082500")}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={44.0}
        lon={-87.5}
        embedded
      />,
    );
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toHaveAttribute("data-source", "usgs");
    expect(badge).toHaveTextContent("USGS");
  });

  it("freshwater + glerl source: DataSourceBadge shows GLERL", async () => {
    h.waterType = "freshwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={makeAvailable("glerl", "GLRL01")}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={44.0}
        lon={-87.5}
        embedded
      />,
    );
    const badge = screen.getByTestId("data-source-badge");
    expect(badge).toHaveAttribute("data-source", "glerl");
    expect(badge).toHaveTextContent("GLERL");
  });

  it("saltwater + unavailable: shows the saltwater tidal station message (regression)", async () => {
    h.waterType = "saltwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={UNAVAILABLE}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={47.5}
        lon={-124.7}
        embedded
      />,
    );
    expect(screen.queryByTestId("tide-freshwater-unavailable")).toBeNull();
    expect(screen.getByText(/tidal station within/i)).toBeInTheDocument();
  });

  it("saltwater + available: shows 'Tide height' label (regression)", async () => {
    h.waterType = "saltwater";
    const { TidePanel } = await import("@/components/TidePanel");
    render(
      <TidePanel
        data={makeAvailable("noaa", "9443090")}
        loading={false}
        depthLayer="surface"
        onDepthLayerChange={vi.fn()}
        scrubDatetime={null}
        onScrubChange={vi.fn()}
        lat={47.5}
        lon={-124.7}
        embedded
      />,
    );
    expect(screen.getByText(/tide height/i)).toBeInTheDocument();
    expect(screen.queryByText(/water level/i)).toBeNull();
  });
});
