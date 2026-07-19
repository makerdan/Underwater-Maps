/**
 * DatasetPanel.folderMove.test.tsx
 *
 * Unit tests for the handleActionMoveToFolder dispatch logic in DatasetPanel.
 *
 * Scenarios covered:
 *   (a) Single folder selected → externalMoveSignal set with kind:"folder" + folder id
 *   (b) Single dataset selected → externalMoveSignal set with kind:"dataset" + dataset id
 *   (c) Multiple datasets selected → bulkMoveSignal set (not externalMoveSignal)
 *   (d) Action bar DOM position — library-action-bar appears in DOM before
 *       the first selected row, not after the last row in the tree
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
  selectedSources: [] as string[],
  toggleVisible: vi.fn(),
  addSelected: vi.fn(),
  removeSelected: vi.fn(),
  setGrids: vi.fn(),
  primaryDatasetId: null as string | null,
  activeGrid: null,
  hideAllOthers: vi.fn(),
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

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: {
    getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }),
  },
}));

vi.mock("@/lib/settingsStore", () => {
  type S = { waterType: "saltwater" | "freshwater"; units: "metric" | "imperial"; bookmarks: unknown[] };
  const state: S = { waterType: "saltwater", units: "metric", bookmarks: [] };
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
    collapsed: { datasets: false, uploadTerrainAccordion: false },
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

// ── DatasetFolderTree mock ─────────────────────────────────────────────────────
// Renders the actionBar prop (so its buttons are accessible) and provides:
//   • "mock-select-folder"  — selects a folder id via onSelectionChange
//   • "mock-select-dataset" — selects a dataset id via onSelectionChange
//   • "mock-select-two-datasets" — selects two dataset ids via onSelectionChange
//   • "captured-signal-kind" / "captured-signal-id" — reflect externalMoveSignal back
//   • "captured-bulk-ids"   — reflects bulkMoveSignal.datasetIds back

vi.mock("@/components/DatasetFolderTree", () => ({
  DatasetFolderTree: ({
    onSelectionChange,
    actionBar,
    externalMoveSignal,
    bulkMoveSignal,
  }: {
    onSelectionChange?: (ids: Set<string>) => void;
    actionBar?: React.ReactNode;
    externalMoveSignal?: { id: string; name: string; folderId: string | null; kind?: string; seq: number } | null;
    bulkMoveSignal?: { datasetIds: string[]; seq: number } | null;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "mock-folder-tree-root" },
      actionBar,
      React.createElement(
        "button",
        {
          "data-testid": "mock-select-folder",
          onClick: () => onSelectionChange?.(new Set(["folder-u1"])),
        },
        "select folder",
      ),
      React.createElement(
        "button",
        {
          "data-testid": "mock-select-dataset",
          onClick: () => onSelectionChange?.(new Set(["dataset-u1"])),
        },
        "select dataset",
      ),
      React.createElement(
        "button",
        {
          "data-testid": "mock-select-two-datasets",
          onClick: () => onSelectionChange?.(new Set(["dataset-u1", "dataset-u2"])),
        },
        "select two datasets",
      ),
      React.createElement(
        "span",
        { "data-testid": "mock-tree-ds-row" },
        "dataset-row-placeholder",
      ),
      React.createElement(
        "span",
        { "data-testid": "captured-signal-kind" },
        externalMoveSignal?.kind ?? "",
      ),
      React.createElement(
        "span",
        { "data-testid": "captured-signal-id" },
        externalMoveSignal?.id ?? "",
      ),
      React.createElement(
        "span",
        { "data-testid": "captured-bulk-ids" },
        bulkMoveSignal ? JSON.stringify(bulkMoveSignal.datasetIds) : "",
      ),
    ),
}));

// ── Fixture data ───────────────────────────────────────────────────────────────

const FOLDER_U1 = {
  id: "folder-u1",
  name: "Survey Zones",
  parentId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const DATASET_U1 = {
  id: "dataset-u1",
  name: "Mariana Survey",
  minDepth: 5,
  maxDepth: 1000,
  folderId: "folder-u1",
  createdAt: "2026-01-01T00:00:00Z",
};

const DATASET_U2 = {
  id: "dataset-u2",
  name: "Pacific Ridge",
  minDepth: 10,
  maxDepth: 2000,
  folderId: null,
  createdAt: "2026-01-01T00:00:00Z",
};

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({
        data: [DATASET_U1, DATASET_U2],
        isLoading: false,
      }),
      useGetUserFolders: () => ({
        data: [FOLDER_U1],
        isLoading: false,
      }),
      useGetMarkers: () => ({ data: undefined }),
    }),
);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DatasetPanel — handleActionMoveToFolder dispatch", () => {
  beforeEach(() => {
    fetchQueryMock.mockReset();
    terrainState.toggleVisible.mockReset();
    terrainState.addSelected.mockReset();
    terrainState.removeSelected.mockReset();
    terrainState.visibleDatasets = [];
    terrainState.selectedIds = [];
    simulatedStore.setPending.mockReset();
    simulatedStore.suppressed = false;
  });

  it("(a) single folder selected → externalMoveSignal kind:folder + correct id", async () => {
    render(<DatasetPanel />);

    // Select the folder via the mock tree
    fireEvent.click(screen.getByTestId("mock-select-folder"));

    // The action bar should now be rendered; click Move To Folder
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-action-move-to-folder"));
    });

    expect(screen.getByTestId("captured-signal-kind").textContent).toBe("folder");
    expect(screen.getByTestId("captured-signal-id").textContent).toBe("folder-u1");
  });

  it("(b) single dataset selected → externalMoveSignal kind:dataset + correct id", async () => {
    render(<DatasetPanel />);

    fireEvent.click(screen.getByTestId("mock-select-dataset"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-action-move-to-folder"));
    });

    expect(screen.getByTestId("captured-signal-kind").textContent).toBe("dataset");
    expect(screen.getByTestId("captured-signal-id").textContent).toBe("dataset-u1");
  });

  it("(c) two datasets selected → bulkMoveSignal set, not externalMoveSignal", async () => {
    render(<DatasetPanel />);

    fireEvent.click(screen.getByTestId("mock-select-two-datasets"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-action-move-to-folder"));
    });

    // Bulk signal must carry both dataset ids
    const bulk = JSON.parse(
      screen.getByTestId("captured-bulk-ids").textContent || "[]",
    ) as string[];
    expect(bulk.sort()).toEqual(["dataset-u1", "dataset-u2"].sort());

    // externalMoveSignal must NOT have been set (kind stays empty)
    expect(screen.getByTestId("captured-signal-kind").textContent).toBe("");
  });

  it("(d) action bar appears in DOM before the first selected tree row, not after", async () => {
    render(<DatasetPanel />);

    // Select the dataset so the action bar is injected
    fireEvent.click(screen.getByTestId("mock-select-dataset"));

    // The actionBar prop is passed to DatasetFolderTree and rendered first
    // in the mock-folder-tree-root div, before the dataset-row placeholder.
    const root = screen.getByTestId("mock-folder-tree-root");
    const actionBar = screen.getByTestId("library-action-bar");
    const dsRow = screen.getByTestId("mock-tree-ds-row");

    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4
    // If dsRow follows actionBar, then actionBar is before dsRow.
    const dsFollowsBar = Boolean(
      actionBar.compareDocumentPosition(dsRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const barFollowsDs = Boolean(
      dsRow.compareDocumentPosition(actionBar) & Node.DOCUMENT_POSITION_FOLLOWING,
    );

    expect(root.contains(actionBar)).toBe(true);
    expect(dsFollowsBar).toBe(true);
    expect(barFollowsDs).toBe(false);
  });
});
