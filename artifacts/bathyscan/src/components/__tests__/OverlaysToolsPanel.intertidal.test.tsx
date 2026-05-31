/**
 * Component tests for the Tidepool / Beachcombing toggle inside
 * OverlaysToolsPanel.
 *
 * Covers:
 * - TIDEPOOL and BEACH mode buttons are absent when intertidalHotspotsEnabled=false.
 * - TIDEPOOL and BEACH mode buttons appear when intertidalHotspotsEnabled=true.
 * - TIDEPOOL button has aria-pressed='true' when intertidalScoreMode='tidepool'.
 * - BEACH button has aria-pressed='false' when intertidalScoreMode='tidepool'.
 * - BEACH button has aria-pressed='true' when intertidalScoreMode='beachcombing'.
 * - TIDEPOOL button has aria-pressed='false' when intertidalScoreMode='beachcombing'.
 * - Clicking BEACH button calls setIntertidalScoreMode('beachcombing').
 * - Clicking TIDEPOOL button calls setIntertidalScoreMode('tidepool').
 * - Clicking either button clears selectedHotspot (via store contract).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Stable mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: { datasetId: "ds-test", habitatPolygons: null },
  }),
}));

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({ loading: false, error: false }),
}));

vi.mock("@/hooks/useWeatherStations", () => ({
  useWeatherStations: () => ({
    isLoading: false,
    isError: false,
    faaWeatherCamsUrl: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/SubstrateLegend", () => ({
  SubstrateLegend: () => null,
}));

vi.mock("@/components/ShoreZoneCredit", () => ({
  ShoreZoneCredit: () => null,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: (sel: (s: { waterType: string }) => unknown) =>
    sel({ waterType: "salt" }),
}));

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: {
      collapsed: { overlaysTools: boolean };
      toggle: () => void;
    }) => unknown,
  ) => sel({ collapsed: { overlaysTools: false }, toggle: vi.fn() }),
}));

// ── api-client-react mock (no EFH, no datasets) ───────────────────────────────

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally") return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: [{ id: "ds-test", hasEfh: false }] }),
    useGetEfh: () => ({ isLoading: false, isError: false, data: undefined }),
  }),
);

// ── Imports under test ────────────────────────────────────────────────────────

import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { useUiStore } from "@/lib/uiStore";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOTSPOT_FIXTURE = {
  unitId: "u1",
  substrate: "rock",
  shoreZoneClass: "B2",
  tidepoolScore: 80,
  beachcombingScore: 60,
  szMaterial: null,
  szForm: null,
  signals: {
    tidepool: { substrate: "rock", bioband: null, debris: null, energy: null, humanUse: null, whySummary: "Tidepool." },
    beachcombing: { substrate: "sand", bioband: null, debris: null, energy: null, humanUse: null, whySummary: "Beach." },
  },
  sourceName: "ShoreZone AK",
  creditUrl: "https://example.com",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetStore(overrides: Partial<ReturnType<typeof useUiStore.getState>> = {}) {
  useUiStore.setState({
    ...useUiStore.getState(),
    intertidalHotspotsEnabled: false,
    intertidalScoreMode: "tidepool",
    selectedHotspot: null,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe("OverlaysToolsPanel — intertidal mode buttons hidden when overlay disabled", () => {
  it("TIDEPOOL button is absent when intertidalHotspotsEnabled=false", () => {
    resetStore({ intertidalHotspotsEnabled: false });
    render(<OverlaysToolsPanel />);
    expect(screen.queryByText(/TIDEPOOL/)).not.toBeInTheDocument();
  });

  it("BEACH button is absent when intertidalHotspotsEnabled=false", () => {
    resetStore({ intertidalHotspotsEnabled: false });
    render(<OverlaysToolsPanel />);
    expect(screen.queryByText(/BEACH/)).not.toBeInTheDocument();
  });
});

describe("OverlaysToolsPanel — intertidal mode buttons visible when overlay enabled", () => {
  beforeEach(() => {
    resetStore({ intertidalHotspotsEnabled: true, intertidalScoreMode: "tidepool" });
  });

  it("TIDEPOOL button is present when intertidalHotspotsEnabled=true", () => {
    render(<OverlaysToolsPanel />);
    expect(screen.getByText("TIDEPOOL")).toBeInTheDocument();
  });

  it("BEACH button is present when intertidalHotspotsEnabled=true", () => {
    render(<OverlaysToolsPanel />);
    expect(screen.getByText("BEACH")).toBeInTheDocument();
  });
});

describe("OverlaysToolsPanel — aria-pressed states in tidepool mode", () => {
  beforeEach(() => {
    resetStore({ intertidalHotspotsEnabled: true, intertidalScoreMode: "tidepool" });
  });

  it("TIDEPOOL button has aria-pressed='true' when mode='tidepool'", () => {
    render(<OverlaysToolsPanel />);
    const tidepoolBtn = screen.getByText("TIDEPOOL").closest("button")!;
    expect(tidepoolBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("BEACH button has aria-pressed='false' when mode='tidepool'", () => {
    render(<OverlaysToolsPanel />);
    const beachBtn = screen.getByText("BEACH").closest("button")!;
    expect(beachBtn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("OverlaysToolsPanel — aria-pressed states in beachcombing mode", () => {
  beforeEach(() => {
    resetStore({ intertidalHotspotsEnabled: true, intertidalScoreMode: "beachcombing" });
  });

  it("BEACH button has aria-pressed='true' when mode='beachcombing'", () => {
    render(<OverlaysToolsPanel />);
    const beachBtn = screen.getByText("BEACH").closest("button")!;
    expect(beachBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("TIDEPOOL button has aria-pressed='false' when mode='beachcombing'", () => {
    render(<OverlaysToolsPanel />);
    const tidepoolBtn = screen.getByText("TIDEPOOL").closest("button")!;
    expect(tidepoolBtn.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("OverlaysToolsPanel — clicking mode buttons updates the store", () => {
  it("clicking BEACH button calls setIntertidalScoreMode('beachcombing')", () => {
    resetStore({ intertidalHotspotsEnabled: true, intertidalScoreMode: "tidepool" });
    render(<OverlaysToolsPanel />);

    const beachBtn = screen.getByText("BEACH").closest("button")!;
    act(() => { fireEvent.click(beachBtn); });

    expect(useUiStore.getState().intertidalScoreMode).toBe("beachcombing");
  });

  it("clicking TIDEPOOL button calls setIntertidalScoreMode('tidepool')", () => {
    resetStore({ intertidalHotspotsEnabled: true, intertidalScoreMode: "beachcombing" });
    render(<OverlaysToolsPanel />);

    const tidepoolBtn = screen.getByText("TIDEPOOL").closest("button")!;
    act(() => { fireEvent.click(tidepoolBtn); });

    expect(useUiStore.getState().intertidalScoreMode).toBe("tidepool");
  });

  it("clicking BEACH clears any open selectedHotspot", () => {
    resetStore({
      intertidalHotspotsEnabled: true,
      intertidalScoreMode: "tidepool",
      selectedHotspot: HOTSPOT_FIXTURE,
    });
    render(<OverlaysToolsPanel />);

    const beachBtn = screen.getByText("BEACH").closest("button")!;
    act(() => { fireEvent.click(beachBtn); });

    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });

  it("clicking TIDEPOOL clears any open selectedHotspot", () => {
    resetStore({
      intertidalHotspotsEnabled: true,
      intertidalScoreMode: "beachcombing",
      selectedHotspot: HOTSPOT_FIXTURE,
    });
    render(<OverlaysToolsPanel />);

    const tidepoolBtn = screen.getByText("TIDEPOOL").closest("button")!;
    act(() => { fireEvent.click(tidepoolBtn); });

    expect(useUiStore.getState().selectedHotspot).toBeNull();
  });
});

describe("OverlaysToolsPanel — 'Highlight mode' section header", () => {
  it("shows 'Highlight mode' label when intertidalHotspotsEnabled=true", () => {
    resetStore({ intertidalHotspotsEnabled: true });
    render(<OverlaysToolsPanel />);
    expect(screen.getByText(/highlight mode/i)).toBeInTheDocument();
  });

  it("hides 'Highlight mode' label when intertidalHotspotsEnabled=false", () => {
    resetStore({ intertidalHotspotsEnabled: false });
    render(<OverlaysToolsPanel />);
    expect(screen.queryByText(/highlight mode/i)).not.toBeInTheDocument();
  });
});
