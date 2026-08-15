/**
 * DatasetPanel.addToView.test.tsx
 *
 * Unit tests for the "Add to View" multi-dataset entry point in DatasetPanel.
 *
 * DatasetPanel reads `visibleDatasets` from terrainStore and passes
 * `onAddToView`, `visibleDatasetIds`, and `atViewCap` to MySavesSection.
 * The handler calls `addSelected` (to add) or `toggleVisible` (to remove).
 *
 * Scenarios covered:
 *   (a) ADD button present when a primary dataset is loaded and row not in view
 *   (b) ADD button disabled when atViewCap=true and dataset not already in view
 *   (c) ADD button shows alternate "IN VIEW" state when already in visibleDatasets
 *   (d) Clicking ADD on a non-active row calls addSelected(dsId, "user")
 *   (e) Clicking IN VIEW on an active row calls toggleVisible({datasetId, source:"user"})
 *   (f) VisibleDatasetsHeader renders once visibleDatasets.length > 1
 *   (g) No primary loaded → onAddToView not wired → ADD button absent on all rows
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

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

// Controllable fetchQuery spy.
const fetchQueryMock = vi.hoisted(() => vi.fn());

// Mutable terrainStore state shared across all tests.
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

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/lib/queryClient", () => ({
  subscribeToReconnect: () => () => {},
  markServerUnreachable: () => {},
  queryClient: {
    fetchQuery: (...args: unknown[]) => fetchQueryMock(...args),
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
    // Legacy alias kept for import compat.
    VISIBLE_DATASETS_CAP: 3,
  };
});

// MySavesSection mock — renders ADD/IN VIEW buttons for two known test dataset IDs.
// Buttons are only rendered when onAddToView is provided (case g asserts absence).
vi.mock("@/components/MySavesSection", () => ({
  MySavesSection: ({
    onAddToView,
    visibleDatasetIds,
    atViewCap,
  }: {
    onAddToView?: (id: string) => void;
    visibleDatasetIds?: Set<string>;
    atViewCap?: boolean;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      onAddToView
        ? React.createElement(
            "button",
            {
              "data-testid": "mock-add-ds1",
              disabled: atViewCap && !visibleDatasetIds?.has("user-ds-1"),
              onClick: () => onAddToView("user-ds-1"),
            },
            visibleDatasetIds?.has("user-ds-1") ? "IN VIEW" : "ADD",
          )
        : null,
      onAddToView
        ? React.createElement(
            "button",
            {
              "data-testid": "mock-add-ds2",
              disabled: atViewCap && !visibleDatasetIds?.has("user-ds-2"),
              onClick: () => onAddToView("user-ds-2"),
            },
            visibleDatasetIds?.has("user-ds-2") ? "IN VIEW" : "ADD",
          )
        : null,
    ),
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
  // Signed-in so MySavesSection (and VisibleDatasetsHeader) renders.
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
  };
  const state: SettingsMockState = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: [],
    saveFolderExpanded: {},
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

vi.mock("@/lib/panelCollapseStore", () => {
  const state = {
    collapsed: {
      datasets: false,
      uploadTerrainAccordion: false,
      myLibrary: false,
    },
    toggle: vi.fn(),
    setCollapsed: vi.fn(),
  };
  return {
    usePanelCollapseStore: (sel: (s: typeof state) => unknown) => sel(state),
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
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
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

// Mutable flag: when true, mySaves returns one ready catalog save (no uploads).
const mySavesHasReady = vi.hoisted(() => ({ value: false }));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({
        data: mySavesHasReady.value ? [] : undefined,
        isLoading: false,
      }),
      useGetDatasetsMySaves: () => ({
        data: mySavesHasReady.value
          ? [
              {
                id: "save-1",
                catalogId: "cat-1",
                status: "ready",
                datasetId: "cat-ds-1",
                requestedAt: new Date().toISOString(),
                displayLabel: "Ready Catalog Save",
                catalog: { name: "Ready Catalog Save", coverageBbox: null },
              },
            ]
          : [],
        isLoading: false,
      }),
      useGetMarkers: () => ({ data: undefined }),
    }),
);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DatasetPanel — handleAddToView multi-dataset entry point", () => {
  beforeEach(() => {
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
    fetchQueryMock.mockReset();
    mySavesHasReady.value = false;
  });

  it("(a) ADD button present when a primary is loaded and dataset not in view", () => {
    terrainState.visibleDatasets = [{ datasetId: "primary-ds", activeGrid: null }];

    render(<DatasetPanel />);

    expect(screen.getByTestId("mock-add-ds1")).toBeInTheDocument();
    expect(screen.getByTestId("mock-add-ds1")).toHaveTextContent("ADD");
  });

  it("(b) ADD button disabled when atViewCap and dataset not already in view", () => {
    // Cap is 3 — fill all slots with non-test datasets.
    terrainState.visibleDatasets = [
      { datasetId: "ds-slot-1", activeGrid: null },
      { datasetId: "ds-slot-2", activeGrid: null },
      { datasetId: "ds-slot-3", activeGrid: null },
    ];

    render(<DatasetPanel />);

    expect(screen.getByTestId("mock-add-ds1")).toBeDisabled();
    expect(screen.getByTestId("mock-add-ds2")).toBeDisabled();
  });

  it("(c) ADD button shows IN VIEW when dataset is already in visibleDatasets", () => {
    terrainState.visibleDatasets = [{ datasetId: "user-ds-1", activeGrid: null }];

    render(<DatasetPanel />);

    expect(screen.getByTestId("mock-add-ds1")).toHaveTextContent("IN VIEW");
  });

  it("(d) clicking ADD on a non-active row calls addSelected(dsId, 'user')", async () => {
    terrainState.visibleDatasets = [{ datasetId: "primary-ds", activeGrid: null }];

    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-add-ds1"));
    });

    expect(terrainState.addSelected).toHaveBeenCalledWith("user-ds-1", "user");
    expect(terrainState.toggleVisible).not.toHaveBeenCalled();
  });

  it("(e) clicking IN VIEW on an active row calls toggleVisible", async () => {
    terrainState.visibleDatasets = [{ datasetId: "user-ds-1", activeGrid: null }];

    render(<DatasetPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-add-ds1"));
    });

    expect(terrainState.toggleVisible).toHaveBeenCalledWith({
      datasetId: "user-ds-1",
      source: "user",
    });
    expect(terrainState.addSelected).not.toHaveBeenCalled();
  });

  it("(f) VisibleDatasetsHeader renders once visibleDatasets.length > 1", () => {
    terrainState.visibleDatasets = [
      { datasetId: "ds-a", activeGrid: null },
      { datasetId: "ds-b", activeGrid: null },
    ];

    render(<DatasetPanel />);

    expect(screen.getByTestId("visible-datasets-header")).toBeInTheDocument();
  });

  it("(g) no primary loaded → onAddToView not wired → ADD button absent on all rows", () => {
    terrainState.visibleDatasets = []; // empty — no primary

    render(<DatasetPanel />);

    expect(screen.queryByTestId("mock-add-ds1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-add-ds2")).not.toBeInTheDocument();
  });

  it("(h) ⬇ All button appears when only catalog saves are present (no uploads)", () => {
    // No uploaded datasets, but one ready catalog save.
    mySavesHasReady.value = true;
    terrainState.visibleDatasets = [];

    render(<DatasetPanel />);

    // The button is shown whenever isSignedIn && (uploads.length > 0 || readyCatalogSaves.length > 0).
    expect(screen.getByTestId("btn-bulk-offline")).toBeInTheDocument();
  });

  it("(i) ⬇ All button is absent when there are no uploads and no ready catalog saves", () => {
    mySavesHasReady.value = false;
    terrainState.visibleDatasets = [];

    render(<DatasetPanel />);

    expect(screen.queryByTestId("btn-bulk-offline")).not.toBeInTheDocument();
  });
});
