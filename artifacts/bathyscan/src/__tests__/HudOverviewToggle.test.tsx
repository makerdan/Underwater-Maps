/**
 * Overview toggle test — the toggle now lives in the sidebar
 * "Overlays & Tools" panel rather than the bottom-right HUD stack,
 * but the contract is the same: the button must mirror `overviewOpen`
 * from the UI store so the `O` keyboard shortcut and the in-map close
 * button stay in sync visually.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    useGetDatasets: () => ({ data: [] }),
  }),
);

import { OverlaysToolsPanel } from "@/components/OverlaysToolsPanel";
import { useUiStore } from "@/lib/uiStore";
import { usePanelCollapseStore } from "@/lib/panelCollapseStore";


vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    terrain: {
      datasetId: "test",
      minLon: 0,
      maxLon: 1,
      minLat: 0,
      maxLat: 1,
      width: 2,
      height: 2,
      depths: [0, 0, 0, 0],
      minDepth: 0,
      maxDepth: 0,
      resolution: 2,
    },
  }),
}));

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();
  const storeState = {
    showCrosshairGps: true,
    showCameraPosition: true,
    showHeading: true,
    coordinateFormat: "decimal" as const,
    depthUnit: "metres" as const,
    units: "metric" as const,
    hudOpacity: 1,
    waterType: "saltwater" as const,
    manualConditionsActiveSource: {} as Record<string, "real" | "manual">,
    datasetManualConditions: {},
  };
  const useSettingsStore = Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});

describe("Overlays & Tools overview toggle", () => {
  beforeEach(() => {
    useUiStore.setState({ overviewOpen: false });
    // Ensure the panel is expanded so the inner toggle is rendered.
    usePanelCollapseStore.setState((s) => ({
      collapsed: { ...s.collapsed, overlaysTools: false },
    }));
  });

  it("renders the overview toggle with aria-pressed=false when closed", () => {
    render(<OverlaysToolsPanel />);
    const btn = screen.getByTestId("hud-toggle-overview");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the overview map when clicked", () => {
    render(<OverlaysToolsPanel />);
    fireEvent.click(screen.getByTestId("hud-toggle-overview"));
    expect(useUiStore.getState().overviewOpen).toBe(true);
  });

  it("reflects external state changes via aria-pressed", () => {
    const { rerender } = render(<OverlaysToolsPanel />);
    expect(screen.getByTestId("hud-toggle-overview")).toHaveAttribute("aria-pressed", "false");
    useUiStore.setState({ overviewOpen: true });
    rerender(<OverlaysToolsPanel />);
    expect(screen.getByTestId("hud-toggle-overview")).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles back to closed on a second click", () => {
    useUiStore.setState({ overviewOpen: true });
    render(<OverlaysToolsPanel />);
    fireEvent.click(screen.getByTestId("hud-toggle-overview"));
    expect(useUiStore.getState().overviewOpen).toBe(false);
  });
});
