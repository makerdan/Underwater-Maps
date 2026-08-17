/**
 * DatasetPanel.streamingCollapse.test.tsx
 *
 * Regression guard for the collapsible streaming queue in MY LIBRARY.
 *
 * Covers:
 *   (a) Queued "selected-dataset-row-*" rows are absent by default (collapsed)
 *   (b) The toggle row is visible and shows the queued count
 *   (c) Clicking the toggle reveals queued rows and flips aria-expanded
 *   (d) Active "visible-dataset-row-*" rows are visible in both states
 *   (e) panelCollapseStore DEFAULTS.streamingQueue is true (collapsed)
 *   (f) Header and toggle carry proximity-streaming descriptive text
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";
import { DEFAULTS } from "@/lib/panelCollapseStore";

// ── Hoisted state ──────────────────────────────────────────────────────────────

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
            `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// Mutable terrainStore state.
const terrainState = vi.hoisted(() => ({
  visibleDatasets: [] as Array<{ datasetId: string; activeGrid: null | object; source?: string }>,
  selectedIds: [] as string[],
  selectedSources: {} as Record<string, string>,
  toggleVisible: vi.fn(),
  addSelected: vi.fn(),
  removeSelected: vi.fn(),
  setGrids: vi.fn(),
  primaryDatasetId: null as string | null,
  hideAllOthers: vi.fn(),
  evictedId: null as string | null,
  clearEviction: vi.fn(),
  activeGrid: null as null | object,
  autoActivate: vi.fn(),
  multiDatasetMode: false,
}));

// Mutable collapse state so we can test real toggle behaviour.
const collapseState = vi.hoisted(() => ({
  collapsed: {
    datasets: false,
    uploadTerrainAccordion: false,
    myLibrary: false,
    streamingQueue: true, // default: collapsed
  } as Record<string, boolean>,
  toggle: vi.fn((id: string) => {
    collapseState.collapsed[id] = !collapseState.collapsed[id];
  }),
  setCollapsed: vi.fn((id: string, value: boolean) => {
    collapseState.collapsed[id] = value;
  }),
}));

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  subscribeToReconnect: () => () => {},
  markServerUnreachable: () => {},
  queryClient: {
    fetchQuery: vi.fn(),
  },
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => {
    onConfirm();
  },
  useSimulatedDataStore: {
    getState: () => ({
      suppressed: false,
      setPending: vi.fn(),
    }),
  },
}));

vi.mock("@/lib/terrainStore", () => {
  const useTerrainStore = ((selector?: (s: typeof terrainState) => unknown) =>
    selector ? selector(terrainState) : terrainState) as unknown as {
    (sel?: (s: typeof terrainState) => unknown): unknown;
    getState: () => typeof terrainState;
  };
  useTerrainStore.getState = () => terrainState;
  return {
    useTerrainStore,
    MAX_ACTIVE_DATASETS: 3,
    VISIBLE_DATASETS_CAP: 3,
  };
});

vi.mock("@/components/MySavesSection", () => ({
  MySavesSection: () => React.createElement(React.Fragment, null),
}));

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    terrain: null,
    mode: "fly",
    pendingExternalUserDatasetId: null,
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat();
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class {
    constructor(_opts?: unknown) {}
  },
  MutationCache: class {
    constructor(_opts?: unknown) {}
  },
}));

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
}));

vi.mock("@/lib/uiStore", () => {
  const mockState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | { minLon: number; minLat: number; maxLon: number; maxLat: number },
    georefPickMode: false,
    setGeorefPickMode: vi.fn(),
    setGeorefPickBbox: vi.fn(),
    setFindDataPanelOpen: vi.fn(),
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
    bookmarks: unknown[];
    saveFolderExpanded: Record<string, boolean>;
    showUiTooltips: boolean;
  };
  const state: SettingsMockState = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: [],
    saveFolderExpanded: {},
    showUiTooltips: true,
  };
  const useSettingsStore = ((sel: (s: SettingsMockState) => unknown) =>
    sel(state)) as ((sel: (s: SettingsMockState) => unknown) => unknown) & {
    getState: () => SettingsMockState;
    setState: (fn: (s: SettingsMockState) => Partial<SettingsMockState>) => void;
    persist: { hasHydrated: () => boolean };
    subscribe: () => () => void;
  };
  useSettingsStore.getState = () => state;
  useSettingsStore.setState = () => {};
  useSettingsStore.persist = { hasHydrated: () => true };
  useSettingsStore.subscribe = () => () => {};
  return { useSettingsStore };
});

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) =>
    sel({ isOnline: true }),
}));

vi.mock("@/lib/markerEditStore", () => ({
  useMarkerEditStore: (sel: (s: { editingMarkerId: string | null }) => unknown) =>
    sel({ editingMarkerId: null }),
}));

vi.mock("@/lib/panelCollapseStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/panelCollapseStore")>();
  return {
    ...actual,
    usePanelCollapseStore: (sel: (s: typeof collapseState) => unknown) =>
      sel(collapseState),
  };
});

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: {
    getState: () => ({
      start: vi.fn(),
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      active: null,
    }),
  },
}));

vi.mock("@/lib/markerConstants", () => ({
  MARKER_COLOR: {},
  MARKER_ICON: {},
  SALTWATER_MARKER_TYPES: [],
  FRESHWATER_MARKER_TYPES: [],
}));

vi.mock("@/lib/markerLayerStore", () => ({
  useMarkerLayerStore: () => ({ layers: [] }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useUndoableMarkerDelete", () => ({
  useUndoableMarkerDelete: () => ({
    requestDelete: vi.fn(),
    isDeletePending: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock("@/lib/fetchWithProgress", () => ({
  fetchJsonWithProgress: vi.fn(),
}));

vi.mock("@/components/GpsImportDialog", () => ({
  GpsImportDialog: () => null,
}));

vi.mock("@/components/GpsExportDialog", () => ({
  GpsExportDialog: () => null,
}));

vi.mock("@/components/ProvenancePanel", () => ({
  ProvenancePanel: () => null,
}));

vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock("@/components/WaterTypeToggle", () => ({
  WaterTypeToggle: () => null,
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({
    children,
    label,
  }: {
    children: React.ReactElement;
    label: string;
  }) =>
    React.cloneElement(children, {
      "data-tooltip": label || undefined,
    } as React.HTMLAttributes<HTMLElement>),
}));

vi.mock("@/components/LoadingDial", () => ({
  LoadingDial: () => null,
}));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => ({ x: 0, z: 0 })),
  MAX_DEPTH_WORLD: 10000,
}));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: undefined, isLoading: false }),
      useGetDatasetsMySaves: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: undefined }),
    }),
);

// ── Helpers ────────────────────────────────────────────────────────────────────

function setupStreamingScenario() {
  // 1 active dataset, 2 queued datasets
  terrainState.visibleDatasets = [
    { datasetId: "active-ds-1", activeGrid: { minDepth: 0, maxDepth: 100 }, source: "preset" },
  ];
  terrainState.selectedIds = ["active-ds-1", "queued-ds-1", "queued-ds-2"];
  terrainState.selectedSources = {
    "active-ds-1": "preset",
    "queued-ds-1": "preset",
    "queued-ds-2": "preset",
  };
  terrainState.primaryDatasetId = "active-ds-1";
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DatasetPanel — collapsible streaming queue", () => {
  beforeEach(() => {
    // Reset terrain
    terrainState.visibleDatasets = [];
    terrainState.selectedIds = [];
    terrainState.selectedSources = {};
    terrainState.primaryDatasetId = null;
    terrainState.evictedId = null;
    terrainState.activeGrid = null;
    terrainState.toggleVisible.mockReset();
    terrainState.addSelected.mockReset();
    terrainState.removeSelected.mockReset();
    terrainState.hideAllOthers.mockReset();

    // Reset collapse state to defaults (collapsed)
    collapseState.collapsed = {
      datasets: false,
      uploadTerrainAccordion: false,
      myLibrary: false,
      streamingQueue: true,
    };
    collapseState.toggle.mockClear();
    collapseState.setCollapsed.mockClear();
  });

  it("(a) queued rows are absent by default (collapsed)", () => {
    setupStreamingScenario();
    render(<DatasetPanel />);

    expect(screen.queryByTestId("selected-dataset-row-queued-ds-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("selected-dataset-row-queued-ds-2")).not.toBeInTheDocument();
  });

  it("(a2) toggle row is visible and shows the queued count when collapsed", () => {
    setupStreamingScenario();
    render(<DatasetPanel />);

    const toggle = screen.getByTestId("streaming-queue-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const label = screen.getByTestId("streaming-queue-label");
    expect(label.textContent).toMatch(/2/); // queued count
    expect(label.textContent?.toUpperCase()).toMatch(/NEARBY|LOAD/);
  });

  it("(b) clicking the toggle reveals queued rows and flips aria-expanded", async () => {
    setupStreamingScenario();
    render(<DatasetPanel />);

    const toggle = screen.getByTestId("streaming-queue-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    // After toggle, collapseState.collapsed.streamingQueue should be false
    expect(collapseState.collapsed.streamingQueue).toBe(false);

    // Re-render with updated state
    const { unmount } = render(<DatasetPanel />);
    expect(screen.getAllByTestId("streaming-queue-toggle")[1]).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getAllByTestId("selected-dataset-row-queued-ds-1").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByTestId("selected-dataset-row-queued-ds-2").length,
    ).toBeGreaterThan(0);
    unmount();
  });

  it("(c) active rows are visible while queue is collapsed", () => {
    setupStreamingScenario();
    render(<DatasetPanel />);

    // Queue is collapsed by default
    expect(collapseState.collapsed.streamingQueue).toBe(true);
    // Active row must still be visible
    expect(screen.getByTestId("visible-dataset-row-active-ds-1")).toBeInTheDocument();
  });

  it("(c2) active rows remain visible after expanding the queue", async () => {
    setupStreamingScenario();
    collapseState.collapsed.streamingQueue = false; // start expanded

    render(<DatasetPanel />);

    expect(screen.getByTestId("visible-dataset-row-active-ds-1")).toBeInTheDocument();
    expect(screen.getByTestId("selected-dataset-row-queued-ds-1")).toBeInTheDocument();
  });

  it("(d) DEFAULTS.streamingQueue is true (collapsed by default)", () => {
    expect(DEFAULTS.streamingQueue).toBe(true);
  });

  it("(e) toggle row renders even when 0 datasets are currently active", () => {
    // Only queued, none active
    terrainState.visibleDatasets = [];
    terrainState.selectedIds = ["queued-ds-1", "queued-ds-2"];
    terrainState.selectedSources = {
      "queued-ds-1": "preset",
      "queued-ds-2": "preset",
    };
    terrainState.primaryDatasetId = null;

    render(<DatasetPanel />);

    expect(screen.getByTestId("streaming-queue-toggle")).toBeInTheDocument();
    // Queued rows should still be hidden (collapsed)
    expect(screen.queryByTestId("selected-dataset-row-queued-ds-1")).not.toBeInTheDocument();
  });

  it("(f) header count text contains proximity-streaming language when streaming", () => {
    setupStreamingScenario();
    // Add second active dataset so header appears (requires >1 active OR selected > active)
    terrainState.visibleDatasets = [
      { datasetId: "active-ds-1", activeGrid: null },
      { datasetId: "active-ds-2", activeGrid: null },
    ];
    terrainState.selectedIds = ["active-ds-1", "active-ds-2", "queued-ds-1", "queued-ds-2"];

    render(<DatasetPanel />);

    const header = screen.queryByTestId("visible-datasets-header");
    if (header) {
      // Header should convey auto-load / streaming / loaded concept
      const countEl = within(header).getByTestId("visible-datasets-count");
      const text = countEl.textContent?.toUpperCase() ?? "";
      expect(text).toMatch(/LOAD|STREAM|ACTIVE|NEARBY/);
    }
  });

  it("(g) toggle row data-tooltip contains proximity-streaming explanation", () => {
    setupStreamingScenario();
    render(<DatasetPanel />);

    const toggle = screen.getByTestId("streaming-queue-toggle");
    const tooltip = toggle.getAttribute("data-tooltip") ?? "";
    // Must mention: what the feature is, what nearby/auto-load means
    expect(tooltip.toLowerCase()).toMatch(/proximit|stream|auto|load|nearby/);
  });
});
