/**
 * DatasetPanel.folderMove.test.tsx
 *
 * Tests for DatasetPanel's user-library callback wiring.
 * The move-to-folder logic now lives entirely inside MySavesSection; these
 * tests verify that DatasetPanel correctly wires and handles the callbacks it
 * passes down to MySavesSection.
 *
 * Scenarios covered:
 *   (a) MySavesSection is mounted inside the MY LIBRARY section when signed in
 *   (b) onLoadUserDataset fires setPendingExternalUserDatasetId with the dataset id
 *   (c) onLoadCatalogSave fires setPendingExternalUserDatasetId with the save's datasetId
 *   (d) onBrowseDatasets calls setFindDataPanelOpen(true) on the uiStore
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

const fetchQueryMock = vi.hoisted(() => vi.fn());

const simulatedStore = vi.hoisted(() => ({
  suppressed: false,
  setPending: vi.fn(),
}));

const terrainState = vi.hoisted(() => ({
  visibleDatasets: [] as Array<{ datasetId: string }>,
  selectedIds: [] as string[],
  selectedSources: {} as Record<string, string>,
  toggleVisible: vi.fn(),
  addSelected: vi.fn(),
  removeSelected: vi.fn(),
  setGrids: vi.fn(),
  primaryDatasetId: null as string | null,
  activeGrid: null,
}));

// Persistent mock handles for asserting on DatasetPanel callback wiring.
const setPendingExternalUserDatasetIdMock = vi.hoisted(() => vi.fn());
const setTerrainMock = vi.hoisted(() => vi.fn());
const setFindDataPanelOpenMock = vi.hoisted(() => vi.fn());

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
      suppressed: simulatedStore.suppressed,
      setPending: simulatedStore.setPending,
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
  return { useTerrainStore, MAX_ACTIVE_DATASETS: 4 };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setTerrain: setTerrainMock,
    terrain: null,
    mode: "fly",
    pendingExternalUserDatasetId: null,
    setPendingExternalUserDatasetId: setPendingExternalUserDatasetIdMock,
    catalogSourcedAt: null,
    setCatalogSourcedAt: vi.fn(),
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
    removeQueries: vi.fn(),
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
    setFindDataPanelOpen: setFindDataPanelOpenMock,
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
  type S = {
    waterType: "saltwater" | "freshwater";
    units: "metric" | "imperial";
    bookmarks: unknown[];
    saveFolderExpanded: Record<string, boolean>;
  };
  const state: S = { waterType: "saltwater", units: "metric", bookmarks: [], saveFolderExpanded: {} };
  const useSettingsStore = ((sel: (s: S) => unknown) => sel(state)) as ((sel: (s: S) => unknown) => unknown) & {
    getState: () => S;
  };
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

vi.mock("@/lib/markerEditStore", () => ({
  useMarkerEditStore: (sel: (s: { editingMarkerId: string | null }) => unknown) =>
    sel({ editingMarkerId: null }),
}));

vi.mock("@/lib/panelCollapseStore", () => {
  const state = {
    collapsed: { datasets: false, uploadTerrainAccordion: false, myLibrary: false },
    toggle: vi.fn(),
    setCollapsed: vi.fn(),
  };
  return { usePanelCollapseStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: {
    getState: () => ({ start: vi.fn(), update: vi.fn(), complete: vi.fn(), fail: vi.fn(), active: null }),
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

vi.mock("@/components/GpsImportDialog", () => ({ GpsImportDialog: () => null }));
vi.mock("@/components/GpsExportDialog", () => ({ GpsExportDialog: () => null }));
vi.mock("@/components/ProvenancePanel", () => ({ ProvenancePanel: () => null }));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/components/WaterTypeToggle", () => ({ WaterTypeToggle: () => null }));
vi.mock("@/components/help/HelpButton", () => ({ HelpIcon: () => null }));
vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock("@/components/LoadingDial", () => ({ LoadingDial: () => null }));
vi.mock("@/components/OfflinePackModal", () => ({ OfflinePackModal: () => null }));
vi.mock("@/components/GeoreferenceModal", () => ({ GeoreferenceModal: () => null }));
vi.mock("@/hooks/useDatasetProximityStreaming", () => ({
  useDatasetProximityStreaming: () => undefined,
}));

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => ({ x: 0, z: 0 })),
  MAX_DEPTH_WORLD: 10000,
}));

// ── MySavesSection mock ────────────────────────────────────────────────────────
// Renders control buttons so tests can fire each DatasetPanel callback without
// depending on the full MySavesSection render tree.

type UserCatalogSave = {
  datasetId?: string | null;
  catalogId: string;
  displayLabel?: string | null;
  catalog?: { name?: string; createdAt?: string } | null;
  folderId?: string | null;
};

vi.mock("@/components/MySavesSection", () => ({
  MySavesSection: ({
    onLoadUserDataset,
    onLoadCatalogSave,
    onBrowseDatasets,
  }: {
    onLoadUserDataset?: (id: string, createdAt?: string | null) => void;
    onLoadCatalogSave?: (save: UserCatalogSave) => void;
    onBrowseDatasets?: () => void;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "my-saves-section" },
      React.createElement(
        "button",
        {
          "data-testid": "mock-load-user-dataset",
          onClick: () => onLoadUserDataset?.("dataset-u1"),
        },
        "Load user dataset",
      ),
      React.createElement(
        "button",
        {
          "data-testid": "mock-load-catalog-save",
          onClick: () =>
            onLoadCatalogSave?.({
              datasetId: "catalog-ds-1",
              catalogId: "cat-1",
              displayLabel: "Test Catalog Save",
              catalog: { createdAt: "2026-01-01T00:00:00Z" },
              folderId: null,
            }),
        },
        "Load catalog save",
      ),
      React.createElement(
        "button",
        {
          "data-testid": "mock-browse-datasets",
          onClick: () => onBrowseDatasets?.(),
        },
        "Browse datasets",
      ),
    ),
}));

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: undefined }),
    }),
);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DatasetPanel — MySavesSection callback wiring", () => {
  beforeEach(() => {
    fetchQueryMock.mockReset();
    terrainState.toggleVisible.mockReset();
    terrainState.addSelected.mockReset();
    terrainState.removeSelected.mockReset();
    terrainState.visibleDatasets = [];
    terrainState.selectedIds = [];
    simulatedStore.setPending.mockReset();
    simulatedStore.suppressed = false;
    setPendingExternalUserDatasetIdMock.mockReset();
    setTerrainMock.mockReset();
    setFindDataPanelOpenMock.mockReset();
  });

  it("(a) MySavesSection is mounted inside the MY LIBRARY section when signed in", () => {
    render(<DatasetPanel />);
    // MY LIBRARY section is expanded by default; MySavesSection should be present.
    expect(screen.getByTestId("my-saves-section")).toBeInTheDocument();
  });

  it("(b) onLoadUserDataset fires setPendingExternalUserDatasetId with the dataset id", async () => {
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-load-user-dataset"));
    });

    // requestDatasetSwitch is mocked to immediately call onConfirm, so
    // setPendingExternalUserDatasetId must be called with "dataset-u1".
    expect(setPendingExternalUserDatasetIdMock).toHaveBeenCalledWith("dataset-u1");
  });

  it("(c) onLoadCatalogSave fires setPendingExternalUserDatasetId with the save's datasetId", async () => {
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-load-catalog-save"));
    });

    expect(setPendingExternalUserDatasetIdMock).toHaveBeenCalledWith("catalog-ds-1");
  });

  it("(d) onBrowseDatasets calls setFindDataPanelOpen(true) on the uiStore", async () => {
    render(<DatasetPanel />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-browse-datasets"));
    });

    expect(setFindDataPanelOpenMock).toHaveBeenCalledWith(true);
  });
});
