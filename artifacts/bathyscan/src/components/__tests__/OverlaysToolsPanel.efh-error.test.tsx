/**
 * Tests for the EFH overlay error-recovery behavior inside OverlaysToolsPanel.
 *
 * Covers:
 * - When useGetEfh transitions to isError=true, efhOverlayEnabled is set to
 *   false in uiStore.
 * - The toast is called with title "EFH overlay failed".
 * - The effect does NOT fire a second time if isError stays true across
 *   re-renders (ref guard: prevEfhError.current prevents double-firing).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";

// ── Stable toast spy ───────────────────────────────────────────────────────────
const mockToast = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Static mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: { datasetId: "ds-efh", habitatPolygons: null },
  }),
}));

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({ loading: false, error: false }),
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

// ── Configurable EFH error state ───────────────────────────────────────────────
// Mutable so individual tests can flip isError between renders.
let mockEfhIsError = false;

vi.mock("@workspace/api-client-react", () => ({
  useGetDatasets: () => ({ data: [{ id: "ds-efh", hasEfh: true }] }),
  getGetDatasetsQueryKey: () => ["/api/datasets"],
  useGetEfh: () => ({
    isLoading: false,
    isError: mockEfhIsError,
    data: undefined,
  }),
  getGetEfhQueryKey: () => ["/api/efh"],
  useGetWeatherStations: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
  getGetWeatherStationsQueryKey: (p: unknown) => ["weather-stations", p],
  useGetRawsStations: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
  getGetRawsStationsQueryKey: (p: unknown) => ["raws-stations", p],
}));

// ── Imports under test ─────────────────────────────────────────────────────────
import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { useUiStore } from "@/lib/uiStore";

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetState() {
  mockEfhIsError = false;
  mockToast.mockClear();
  useUiStore.setState({
    ...useUiStore.getState(),
    efhOverlayEnabled: true,
    hiddenEfhSpecies: new Set<string>(),
    selectedEfh: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("OverlaysToolsPanel — EFH overlay error-recovery", () => {
  beforeEach(resetState);

  it("sets efhOverlayEnabled to false in uiStore when useGetEfh transitions to isError=true", () => {
    const { rerender } = render(<OverlaysToolsPanel />);

    expect(useUiStore.getState().efhOverlayEnabled).toBe(true);

    mockEfhIsError = true;
    act(() => {
      rerender(<OverlaysToolsPanel />);
    });

    expect(useUiStore.getState().efhOverlayEnabled).toBe(false);
  });

  it("calls toast with title 'EFH overlay failed' when useGetEfh transitions to isError=true", () => {
    const { rerender } = render(<OverlaysToolsPanel />);

    mockEfhIsError = true;
    act(() => {
      rerender(<OverlaysToolsPanel />);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "EFH overlay failed" }),
    );
  });

  it("does NOT call toast a second time when isError stays true across subsequent re-renders (ref guard)", () => {
    const { rerender } = render(<OverlaysToolsPanel />);

    // First transition: false → true. Toast fires once.
    mockEfhIsError = true;
    act(() => {
      rerender(<OverlaysToolsPanel />);
    });

    expect(mockToast).toHaveBeenCalledTimes(1);

    // isError remains true. The ref guard (prevEfhError.current === true)
    // should prevent the effect from entering the toast branch again.
    mockToast.mockClear();
    act(() => {
      rerender(<OverlaysToolsPanel />);
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});
