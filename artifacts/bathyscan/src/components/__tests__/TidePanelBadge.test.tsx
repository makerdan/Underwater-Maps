/**
 * TidePanelBadge — unit tests verifying that <TidePanel> correctly wires
 * the LocationBadge component in both its embedded and standalone rendering
 * modes, across the loading and ready states.
 *
 * This file complements LocationBadge.test.tsx (which tests the badge
 * component in isolation) by testing TidePanel's own rendering paths so
 * a future refactor that removes or re-wires the badge inside TidePanel
 * will fail here, not silently ship.
 *
 * TidePanel's LocationBadge uses:
 *   - terrain from useAppState() as the dataset name source
 *   - the `lat` / `lon` props (passed from App.tsx) for coordinates
 *   - the `loading` prop (tidalLoading from useTidalData) for state
 *
 * Covered scenarios:
 *   1. Embedded path (embedded=true) — ready state
 *   2. Embedded path (embedded=true) — loading state
 *   3. Standalone path (embedded=false, collapsed=false) — ready state
 *   4. Standalone path (embedded=false, collapsed=false) — loading state
 *   5. Badge is absent when terrain is null (no location context yet)
 *   6. Badge is absent when lat/lon are null
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TidalDataResult } from "@/hooks/useTidalData";

// ---------------------------------------------------------------------------
// Mocks — must be declared before TidePanel is imported
// ---------------------------------------------------------------------------

const mockTerrain = {
  datasetId: "mock-ds",
  name: "Mock Bay",
  minLat: 47.0,
  maxLat: 48.0,
  minLon: -125.0,
  maxLon: -124.0,
  minDepth: 0,
  maxDepth: 200,
  resolution: 4,
  depths: [],
};

let mockTerrainValue: typeof mockTerrain | null = mockTerrain;

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: mockTerrainValue }),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (selector: (s: { collapsed: { tide: boolean }; toggle: () => void }) => unknown) =>
    selector({ collapsed: { tide: false }, toggle: vi.fn() }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = { ...actual.DEFAULT_SETTINGS, units: "metric" as const, defaultTidalDepthLayer: "surface" as const };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
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
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const READY_TIDAL_DATA: TidalDataResult = {
  available: true,
  tideHeight: 1.23,
  currentDirection: 90,
  currentSpeed: 0.6,
  stationName: "Mock NOAA Station",
  stationId: "MOCK01",
  isPredicted: false,
  source: "noaa",
  nextEvent: {
    type: "high",
    time: new Date(Date.now() + 3_600_000).toISOString(),
    height: 1.5,
  },
  slack: {
    isSlack: false,
    phase: "flooding",
    minutesToSlack: 45,
    minutesSinceSlack: 0,
    nextReversalAt: new Date(Date.now() + 45 * 60_000).toISOString(),
  },
};

const LAT = 47.5;
const LON = -124.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProps(overrides: {
  loading?: boolean;
  embedded?: boolean;
  lat?: number | null;
  lon?: number | null;
}) {
  return {
    data: READY_TIDAL_DATA,
    loading: false,
    depthLayer: "surface" as const,
    onDepthLayerChange: vi.fn(),
    scrubDatetime: null,
    onScrubChange: vi.fn(),
    lat: LAT,
    lon: LON,
    embedded: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TidePanel — LocationBadge wiring", () => {
  beforeEach(() => {
    mockTerrainValue = mockTerrain;
  });

  describe("embedded mode (embedded=true)", () => {
    it("renders the badge in ready state when loading=false", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: true, loading: false })} />);
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "ready");
      expect(badge).toHaveTextContent("Mock Bay");
      expect(badge).toHaveTextContent("47.5°N");
      expect(badge).toHaveTextContent("124.7°W");
    });

    it("renders the badge in loading state when loading=true", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: true, loading: true })} />);
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "loading");
      expect(badge).toHaveTextContent("Updating…");
    });
  });

  describe("standalone mode (embedded=false, panel not collapsed)", () => {
    it("renders the badge in ready state when loading=false", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: false, loading: false })} />);
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "ready");
      expect(badge).toHaveTextContent("Mock Bay");
      expect(badge).toHaveTextContent("47.5°N");
      expect(badge).toHaveTextContent("124.7°W");
    });

    it("renders the badge in loading state when loading=true", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: false, loading: true })} />);
      const badge = screen.getByTestId("location-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "loading");
      expect(badge).toHaveTextContent("Updating…");
    });
  });

  describe("badge absent when context is missing", () => {
    it("does not render the badge when terrain is null", async () => {
      mockTerrainValue = null;
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: true })} />);
      expect(screen.queryByTestId("location-badge")).toBeNull();
    });

    it("does not render the badge when lat is null", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: true, lat: null })} />);
      expect(screen.queryByTestId("location-badge")).toBeNull();
    });

    it("does not render the badge when lon is null", async () => {
      const { TidePanel } = await import("@/components/TidePanel");
      render(<TidePanel {...buildProps({ embedded: true, lon: null })} />);
      expect(screen.queryByTestId("location-badge")).toBeNull();
    });
  });
});
