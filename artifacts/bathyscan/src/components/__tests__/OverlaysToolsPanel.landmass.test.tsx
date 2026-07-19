/**
 * OverlaysToolsPanel — showLandmass toggle tests
 *
 * Covers:
 * - "Show landmass" ToggleButton is rendered (testId="overlay-toggle-landmass").
 * - When showLandmass=false the button has aria-pressed="false".
 * - When showLandmass=true the button has aria-pressed="true".
 * - Clicking the button calls setShowLandmass with the toggled value.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: { datasetId: "ds-lm", habitatPolygons: null },
    tidalOverlay: null,
    setTidalOverlay: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({ loading: false, error: false }),
}));

vi.mock("@/hooks/useWeatherStations", () => ({
  useWeatherStations: () => ({
    isLoading: false,
    isError: false,
    noaaUnavailable: false,
    faaWeatherCamsUrl: null,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useTemperatureProfile", () => ({
  useTemperatureProfile: () => ({ profile: null, loading: false }),
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

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: {
      collapsed: Record<string, boolean>;
      toggle: () => void;
    }) => unknown,
  ) =>
    sel({
      collapsed: {
        overlaysTools: false,
        overlaysTerrainAdvanced: false,
        overlaysToolsAdvanced: false,
      },
      toggle: vi.fn(),
    }),
}));

const mockSetShowLandmass = vi.hoisted(() => vi.fn());

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState: Record<string, unknown> = {
    waterType: "saltwater",
    showWaterTempLayer: false,
    showLandmass: false,
    setShowLandmass: mockSetShowLandmass,
    setShowWaterTempLayer: vi.fn(),
  };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: (patch: Partial<typeof storeState>) => { Object.assign(storeState, patch); },
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
      __landmassStoreState: storeState,
    },
  );
  return { ...actual, useSettingsStore };
});

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
    useGetDatasets: () => ({ data: [{ id: "ds-lm", hasEfh: false }] }),
    useGetEfh: () => ({ isLoading: false, isError: false, data: undefined }),
  }),
);

import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { useSettingsStore } from "@/lib/settingsStore";

function setLandmass(value: boolean) {
  const state = (useSettingsStore as unknown as { __landmassStoreState: Record<string, unknown> })
    .__landmassStoreState;
  if (state) state["showLandmass"] = value;
}

beforeEach(() => {
  mockSetShowLandmass.mockClear();
  setLandmass(false);
});

describe("OverlaysToolsPanel — Show landmass toggle rendered", () => {
  it("renders the 'SHOW LANDMASS' button", () => {
    render(<OverlaysToolsPanel />);
    expect(screen.getByTestId("overlay-toggle-landmass")).toBeInTheDocument();
  });

  it("button is labelled 'SHOW LANDMASS'", () => {
    render(<OverlaysToolsPanel />);
    expect(screen.getByText(/SHOW LANDMASS/i)).toBeInTheDocument();
  });
});

describe("OverlaysToolsPanel — aria-pressed reflects showLandmass state", () => {
  it("aria-pressed='false' when showLandmass=false", () => {
    setLandmass(false);
    render(<OverlaysToolsPanel />);
    const btn = screen.getByTestId("overlay-toggle-landmass");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("aria-pressed='true' when showLandmass=true", () => {
    setLandmass(true);
    render(<OverlaysToolsPanel />);
    const btn = screen.getByTestId("overlay-toggle-landmass");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("OverlaysToolsPanel — clicking the button calls setShowLandmass", () => {
  it("click when showLandmass=false calls setShowLandmass(true)", () => {
    setLandmass(false);
    render(<OverlaysToolsPanel />);
    const btn = screen.getByTestId("overlay-toggle-landmass");
    act(() => { fireEvent.click(btn); });
    expect(mockSetShowLandmass).toHaveBeenCalledWith(true);
  });

  it("click when showLandmass=true calls setShowLandmass(false)", () => {
    setLandmass(true);
    render(<OverlaysToolsPanel />);
    const btn = screen.getByTestId("overlay-toggle-landmass");
    act(() => { fireEvent.click(btn); });
    expect(mockSetShowLandmass).toHaveBeenCalledWith(false);
  });
});
