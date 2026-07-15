/**
 * DatasetPanel.loadTogether.test.tsx
 *
 * Unit tests for the handleLoadTogether preflight logic in DatasetPanel.
 *
 * handleLoadTogether runs parallel preview fetches for selected preset
 * datasets; if any return a synthetic/unknown dataSource it calls
 * useSimulatedDataStore.setPending to open the warning dialog.
 *
 * Scenarios covered:
 *   (a) All presets return real data → toggleVisible called immediately, no dialog
 *   (b) At least one preset returns synthetic → dialog opens; confirm → toggles;
 *       cancel → no toggles
 *   (c) Suppression active → toggleVisible called immediately (no preflight)
 *   (d) Only library IDs selected → toggleVisible called immediately (no preflight)
 *   (e) Preflight fetch throws → treated as "proceed" (toggles immediately)
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

// Controllable fetchQuery spy — the test overrides its return value per scenario.
const fetchQueryMock = vi.hoisted(() => vi.fn());

// Mutable state for simulatedDataStore so each test can set suppressed/spy on setPending.
const simulatedStore = vi.hoisted(() => ({
  suppressed: false,
  setPending: vi.fn(),
}));

// Mutable state for terrainStore so each test can assert toggleVisible calls.
const terrainState = vi.hoisted(() => ({
  visibleDatasets: [] as Array<{ datasetId: string }>,
  selectedIds: [] as string[],
  toggleVisible: vi.fn(),
  addSelected: vi.fn(),
  removeSelected: vi.fn(),
  setGrids: vi.fn(),
  primaryDatasetId: null as string | null,
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
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 4 };
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
  // Use signed-in so the MY LIBRARY section (DatasetFolderTree) renders.
  // DatasetFolderTree is gated by {isSignedIn && ...} in DatasetPanel.
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

vi.mock("@/lib/uiStore", () => ({
  useUiStore: { getState: () => ({ setPendingDropIn: vi.fn() }) },
}));

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
  };
  const state: SettingsMockState = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: [],
  };
  const useSettingsStore = ((sel: (s: SettingsMockState) => unknown) =>
    sel(state)) as ((sel: (s: SettingsMockState) => unknown) => unknown) & {
    getState: () => SettingsMockState;
  };
  useSettingsStore.getState = () => state;
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
  useUndoableMarkerDelete: () => vi.fn(),
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

// DatasetFolderTree mock renders a trigger that simulates selecting a library dataset.
// This lets case (d) set librarySelectedIds without going through real tree UI.
vi.mock("@/components/DatasetFolderTree", () => ({
  DatasetFolderTree: ({
    onSelectionChange,
  }: {
    onSelectionChange: (ids: Set<string>) => void;
  }) =>
    React.createElement("button", {
      "data-testid": "mock-select-library",
      onClick: () => onSelectionChange(new Set(["lib-ds-1"])),
    }, "select library"),
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

// Two saltwater preset datasets for the tests.
const PRESET_A = {
  id: "preset-alpha",
  name: "Alpha Bay",
  description: "Test preset A",
  minDepth: 0,
  maxDepth: 200,
  waterType: "saltwater",
};

const PRESET_B = {
  id: "preset-beta",
  name: "Beta Fjord",
  description: "Test preset B",
  minDepth: 5,
  maxDepth: 500,
  waterType: "saltwater",
};

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({
        data: [PRESET_A, PRESET_B],
        isLoading: false,
      }),
      useGetUserDatasets: () => ({ data: undefined, isLoading: false }),
      useGetMarkers: () => ({ data: undefined }),
    }),
);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Select preset checkboxes by id and click "Load Together". */
async function selectPresetsAndLoadTogether(...ids: string[]): Promise<void> {
  for (const id of ids) {
    fireEvent.click(screen.getByTestId(`chk-preset-${id}`));
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId("btn-action-load-together"));
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DatasetPanel — handleLoadTogether preflight", () => {
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

  it("(a) all presets return real data → addSelected called immediately, dialog never opened", async () => {
    // Both preview fetches resolve with a real (non-synthetic) dataSource.
    fetchQueryMock.mockResolvedValue({ dataSource: "ncei", name: "Alpha Bay" });

    render(<DatasetPanel />);
    await selectPresetsAndLoadTogether(PRESET_A.id, PRESET_B.id);

    // addSelected must have been called for each selected preset.
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_A.id, "preset");
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_B.id, "preset");

    // The simulated-data dialog must NOT have been triggered.
    expect(simulatedStore.setPending).not.toHaveBeenCalled();
  });

  it("(b-confirm) one preset is synthetic → dialog opens; confirm → addSelected called for all presets", async () => {
    // First preset is real, second is synthetic.
    fetchQueryMock
      .mockResolvedValueOnce({ dataSource: "gebco", name: "Alpha Bay" })
      .mockResolvedValueOnce({ dataSource: "synthetic", name: "Beta Fjord", syntheticReason: "no survey data" });

    render(<DatasetPanel />);
    await selectPresetsAndLoadTogether(PRESET_A.id, PRESET_B.id);

    // setPending must be called with the first simulated dataset's info.
    expect(simulatedStore.setPending).toHaveBeenCalledTimes(1);
    const pendingArg = simulatedStore.setPending.mock.calls[0]![0]!;
    expect(pendingArg.datasetId).toBe(PRESET_B.id);
    expect(pendingArg.datasetName).toBe("Beta Fjord");

    // addSelected must NOT have been called yet (waiting for user confirmation).
    expect(terrainState.addSelected).not.toHaveBeenCalled();

    // Simulate the user confirming the dialog.
    await act(async () => {
      pendingArg.onConfirm();
    });

    // After confirmation, addSelected fires for all presets.
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_A.id, "preset");
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_B.id, "preset");
  });

  it("(b-cancel) one preset is synthetic → dialog opens; cancel → no addSelected at all", async () => {
    fetchQueryMock
      .mockResolvedValueOnce({ dataSource: "ncei", name: "Alpha Bay" })
      .mockResolvedValueOnce({ dataSource: "unknown", name: "Beta Fjord" });

    render(<DatasetPanel />);
    await selectPresetsAndLoadTogether(PRESET_A.id, PRESET_B.id);

    expect(simulatedStore.setPending).toHaveBeenCalledTimes(1);
    const pendingArg = simulatedStore.setPending.mock.calls[0]![0]!;

    // Simulate the user cancelling the dialog.
    await act(async () => {
      pendingArg.onCancel();
    });

    // addSelected must never have been called.
    expect(terrainState.addSelected).not.toHaveBeenCalled();
  });

  it("(c) suppression active → addSelected called immediately, preflight fetch never runs", async () => {
    simulatedStore.suppressed = true;

    render(<DatasetPanel />);
    await selectPresetsAndLoadTogether(PRESET_A.id);

    // Suppression bypasses the preflight entirely.
    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(simulatedStore.setPending).not.toHaveBeenCalled();
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_A.id, "preset");
  });

  it("(d) only library IDs selected → addSelected called immediately with no preflight", async () => {
    render(<DatasetPanel />);

    // Trigger library selection via the mock DatasetFolderTree button, then Load Together.
    fireEvent.click(screen.getByTestId("mock-select-library"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-action-load-together"));
    });

    // No preflight fetches should occur for library-only selections.
    expect(fetchQueryMock).not.toHaveBeenCalled();
    expect(simulatedStore.setPending).not.toHaveBeenCalled();

    // Library dataset added to selected pool immediately.
    expect(terrainState.addSelected).toHaveBeenCalledWith("lib-ds-1", "user");
  });

  it("(e) preflight fetch throws → treated as 'proceed' (addSelected immediately, no dialog)", async () => {
    fetchQueryMock.mockRejectedValue(new Error("Network error"));

    render(<DatasetPanel />);
    await selectPresetsAndLoadTogether(PRESET_A.id);

    // An error during preflight is treated as a null preview (dataSource not synthetic),
    // so the load proceeds without opening the dialog.
    expect(simulatedStore.setPending).not.toHaveBeenCalled();
    expect(terrainState.addSelected).toHaveBeenCalledWith(PRESET_A.id, "preset");
  });
});
