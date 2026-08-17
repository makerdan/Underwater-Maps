/**
 * Regression guard: DatasetPanel's PANEL style must use a viewport-relative
 * minWidth so the panel does not overflow narrow viewports.
 *
 * F-011 UX audit: the original value `minWidth: 536` (px) caused the panel
 * to clip off-screen on viewports narrower than ~580 px.  The fix replaced it
 * with `minWidth: "min(536px, 100vw - 32px)"`.
 *
 * This test renders DatasetPanel and asserts that the outermost panel
 * container carries a minWidth value that references "vw" or "min(",
 * preventing a future edit from silently reverting to a bare pixel integer.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";
import { usePanelCollapseStore, DEFAULTS } from "@/lib/panelCollapseStore";

// ---------------------------------------------------------------------------
// Hoisted proxy factory (same pattern as other DatasetPanel test files)
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: noop,
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (
          typeof p === "symbol" ||
          p === "then" ||
          p === "catch" ||
          p === "finally"
        )
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k))
          return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    terrain: null,
    mode: "fly",
    setPendingExternalUserDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
}));

vi.mock("@/lib/terrainStore", () => {
  const state = {
    setGrids: vi.fn(),
    setSinglePrimary: vi.fn(),
    multiDatasetMode: false,
    visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null,
    toggleVisible: vi.fn(),
    addSelected: vi.fn(),
    removeSelected: vi.fn(),
    autoActivate: vi.fn(),
    autoEvict: vi.fn(),
    clearAutoEviction: vi.fn(),
    selectedIds: [] as string[],
    selectedSources: {} as Record<string, string>,
    evictedId: null as string | null,
    autoEvictedId: null as string | null,
    clearEviction: vi.fn(),
  };
  const useTerrainStore = ((selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useTerrainStore.getState = () => state;
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 3, MAX_ACTIVE_DATASETS: 3 };
});

vi.mock("@/lib/uiStore", () => {
  const mockState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | { minLon: number; minLat: number; maxLon: number; maxLat: number },
    georefPickMode: false,
    setGeorefPickMode: vi.fn(),
    setGeorefPickBbox: vi.fn(),
  };
  const useUiStore = Object.assign(
    (sel: (s: typeof mockState) => unknown) => sel(mockState),
    { getState: () => mockState },
  );
  return { useUiStore };
});

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => {
  type SettingsMockState = {
    waterType: "saltwater" | "freshwater";
    units: "metric" | "imperial";
    saveFolderExpanded: Record<string, boolean>;
  };
  const state: SettingsMockState = {
    waterType: "saltwater",
    units: "metric",
    saveFolderExpanded: {},
  };
  const useSettingsStore = ((sel: (s: SettingsMockState) => unknown) =>
    sel(state)) as ((sel: (s: SettingsMockState) => unknown) => unknown) & {
    getState: () => SettingsMockState;
    persist: { hasHydrated: () => boolean };
    setState: (partial: Partial<SettingsMockState>) => void;
    subscribe: () => () => void;
  };
  useSettingsStore.getState = () => state;
  useSettingsStore.persist = { hasHydrated: () => true };
  useSettingsStore.setState = () => {};
  useSettingsStore.subscribe = () => () => {};
  return { useSettingsStore };
});

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => {
    onConfirm();
  },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/contextMenuStore", () => ({
  useContextMenuStore: {
    getState: () => ({ show: vi.fn() }),
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DragOverlay: () => null,
  useDraggable: () => ({ setNodeRef: vi.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  PointerSensor: vi.fn(),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: [] }),
      useGetUserFolders: () => ({ data: [], isLoading: false }),
      useGetDatasetsMySaves: () => ({
        data: [],
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch: () => Promise.resolve(),
      }),
    }),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatasetPanel — responsive minWidth style", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("renders the panel with a viewport-relative minWidth (not a bare pixel integer > 400)", () => {
    const { container } = render(<DatasetPanel />);

    // Walk the rendered DOM tree looking for the first element whose inline
    // minWidth style is set (that's the PANEL style object at the root of
    // DatasetPanel's JSX output).
    let panelEl: Element | null = null;
    const walk = (el: Element) => {
      if (panelEl) return;
      const mw = (el as HTMLElement).style?.minWidth;
      if (mw && mw !== "0px" && mw !== "") {
        panelEl = el;
        return;
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(container);

    expect(panelEl).not.toBeNull();
    if (panelEl === null) return; // type narrowing — expect above already fails if null
    const minWidthValue = (panelEl as HTMLElement).style.minWidth;

    // The value must reference vw units or a CSS min() function.
    // A bare pixel value like "536px" would fail this assertion, which is
    // exactly what we want to catch if someone reverts the fix.
    const isViewportRelative =
      minWidthValue.includes("vw") || minWidthValue.includes("min(");

    expect(
      isViewportRelative,
      `DatasetPanel's minWidth style "${minWidthValue}" should use vw or min() — bare pixel values cause overflow on narrow viewports`,
    ).toBe(true);
  });
});
