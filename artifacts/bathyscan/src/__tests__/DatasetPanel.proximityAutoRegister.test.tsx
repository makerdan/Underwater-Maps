/**
 * DatasetPanel.proximityAutoRegister.test.tsx
 *
 * Verifies the proximity auto-registration effect in DatasetPanel:
 *   - When proximityMode is ON, user datasets WITH a valid bbox are enrolled
 *     in the proximity pool via addSelectedToPool (not addSelected).
 *   - User datasets WITHOUT a bbox are NOT auto-enrolled (to prevent
 *     immediate "always-nearby" activation by the proximity hook).
 *   - Preset catalog entries are always auto-enrolled regardless of bbox.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, act } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";
import { useSettingsStore } from "@/lib/settingsStore";
import { __resetAutoRegisteredIds } from "@/hooks/useProximityStreamingWiring";

// ── Hoisted state ──────────────────────────────────────────────────────────────

const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return () => ({ data: undefined, isLoading: false, isError: false });
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// Mutable API data state — tests write here before rendering.
const apiState = vi.hoisted(() => ({
  presets: [] as Array<{ id: string; name: string; minDepth: number; maxDepth: number; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null }>,
  userDatasets: [] as Array<{ id: string; name: string; minDepth: number; maxDepth: number; createdAt: string; bbox?: { minLon: number; maxLon: number; minLat: number; maxLat: number } | null }>,
}));

// Mutable terrainStore state shared across tests.
const terrainStoreMock = vi.hoisted(() => {
  const state = {
    visibleDatasets: [] as Array<{ datasetId: string; source: string }>,
    primaryDatasetId: null as string | null,
    selectedIds: [] as string[],
    selectedSources: {} as Record<string, string>,
    evictedId: null as string | null,
    autoEvictedId: null as string | null,
    toggleVisible: vi.fn(),
    addSelected: vi.fn(),
    addSelectedToPool: vi.fn((id: string, source: string) => {
      if (!state.selectedIds.includes(id)) {
        state.selectedIds = [...state.selectedIds, id];
        state.selectedSources = { ...state.selectedSources, [id]: source };
      }
    }),
    removeSelected: vi.fn((id: string) => {
      state.selectedIds = state.selectedIds.filter((x) => x !== id);
      const { [id]: _removed, ...rest } = state.selectedSources;
      state.selectedSources = rest;
      state.visibleDatasets = state.visibleDatasets.filter((v) => v.datasetId !== id);
    }),
    autoActivate: vi.fn(),
    autoEvict: vi.fn(),
    clearAutoEviction: vi.fn(),
    clearEviction: vi.fn(),
    setGrids: vi.fn(),
  };
  return state;
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({ data: apiState.presets, isLoading: false }),
    useGetUserDatasets: () => ({ data: apiState.userDatasets, isLoading: false }),
  }),
);

vi.mock("react-dropzone", () => ({
  useDropzone: () => ({
    getRootProps: () => ({ "data-testid": "dropzone-terrain" }),
    getInputProps: () => ({ "data-testid": "dropzone-input" }),
    isDragActive: false,
  }),
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
    fetchQuery: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class { constructor(_opts?: unknown) {} },
  MutationCache: class { constructor(_opts?: unknown) {} },
}));

vi.mock("@/lib/terrainStore", () => {
  const s = terrainStoreMock;
  const useTerrainStore = Object.assign(
    (selector?: (st: typeof s) => unknown) => selector ? selector(s) : s,
    { getState: () => s },
  );
  return { useTerrainStore, VISIBLE_DATASETS_CAP: 3, MAX_ACTIVE_DATASETS: 3 };
});

vi.mock("@/lib/settingsStore", () => {
  const state = {
    waterType: "saltwater" as const,
    units: "metric" as const,
    bookmarks: [] as unknown[],
    proximityMode: true,
    maxActiveDatasets: 3,
    setProximityMode: vi.fn(),
    setMaxActiveDatasets: vi.fn(),
    persist: { hasHydrated: () => true },
    subscribe: vi.fn(() => () => {}),
  };
  const useSettingsStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => selector ? selector(state) : state,
    { getState: () => state },
  );
  return { useSettingsStore };
});

vi.mock("@/lib/uiStore", () => {
  const mockState = {
    setPendingDropIn: vi.fn(),
    georefPickBbox: null as null | { minLon: number; minLat: number; maxLon: number; maxLat: number },
    georefPickMode: false,
    setGeorefPickMode: vi.fn(),
    setGeorefPickBbox: vi.fn(),
  };
  return {
    useUiStore: Object.assign(
      (sel: (s: typeof mockState) => unknown) => sel(mockState),
      { getState: () => mockState },
    ),
  };
});

vi.mock("@/lib/classificationStore", () => ({
  useClassificationStore: { getState: () => ({ clearZoneMap: vi.fn(), classify: vi.fn() }) },
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => { onConfirm(); },
}));

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

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/hooks/useUndoableMarkerDelete", () => ({
  useUndoableMarkerDelete: () => ({ handleDelete: vi.fn() }),
}));

vi.mock("@/lib/fetchWithProgress", () => ({ fetchJsonWithProgress: vi.fn() }));

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

vi.mock("@/lib/units", () => ({
  formatDepthRange: (min: number, max: number, units: string) =>
    `${min} ${units} to ${max} ${units}`,
}));

vi.mock("@/lib/terrain", () => ({
  lonLatToWorldXZ: vi.fn(() => [0, 0]),
  MAX_DEPTH_WORLD: 10000,
}));

// The proximity streaming hook is a side-effect machine; mock it to a no-op
// so that auto-activation never fires in these registration-only tests.
vi.mock("@/hooks/useDatasetProximityStreaming", () => ({
  useDatasetProximityStreaming: vi.fn(),
}));

// ── Shared fixture data ────────────────────────────────────────────────────────

const BBOX = { minLon: -134, maxLon: -130, minLat: 56, maxLat: 58 };

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  apiState.presets = [];
  apiState.userDatasets = [];

  terrainStoreMock.selectedIds = [];
  terrainStoreMock.selectedSources = {};
  terrainStoreMock.visibleDatasets = [];
  terrainStoreMock.addSelectedToPool.mockClear();
  terrainStoreMock.addSelected.mockClear();
  terrainStoreMock.removeSelected.mockClear();

  // Reset the module-level autoRegisteredIds set so each test starts clean.
  __resetAutoRegisteredIds();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatasetPanel — proximity auto-registration: user dataset bbox gating", () => {
  it("auto-enrolls a user dataset that has a valid bbox via addSelectedToPool (not addSelected)", async () => {
    apiState.userDatasets = [
      { id: "user-bbox-1", name: "Survey A", minDepth: 0, maxDepth: 100, createdAt: "2024-01-01T00:00:00Z", bbox: BBOX },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    // Pool-only enrollment must go through addSelectedToPool.
    expect(terrainStoreMock.addSelectedToPool).toHaveBeenCalledWith("user-bbox-1", "user");
    // Regular addSelected must NOT be called — it activates when slots are available.
    const addSelectedIds = terrainStoreMock.addSelected.mock.calls.map((c) => c[0]);
    expect(addSelectedIds).not.toContain("user-bbox-1");
  });

  it("does NOT auto-enroll a user dataset that has no bbox (no-georef guard)", async () => {
    apiState.userDatasets = [
      { id: "user-no-bbox", name: "Survey B (pending georef)", minDepth: 0, maxDepth: 50, createdAt: "2024-01-01T00:00:00Z", bbox: null },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    const enrolledIds = terrainStoreMock.addSelectedToPool.mock.calls.map((c) => c[0]);
    expect(enrolledIds).not.toContain("user-no-bbox");
  });

  it("enrolls bbox datasets but skips null-bbox ones when both are present", async () => {
    apiState.userDatasets = [
      { id: "user-has-bbox", name: "Survey C", minDepth: 0, maxDepth: 80, createdAt: "2024-01-01T00:00:00Z", bbox: BBOX },
      { id: "user-lacks-bbox", name: "Survey D (no georef)", minDepth: 0, maxDepth: 30, createdAt: "2024-01-01T00:00:00Z", bbox: null },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    const enrolledIds = terrainStoreMock.addSelectedToPool.mock.calls.map((c) => c[0]);
    expect(enrolledIds).toContain("user-has-bbox");
    expect(enrolledIds).not.toContain("user-lacks-bbox");
  });
});

describe("DatasetPanel — proximity auto-registration: preset catalog entries", () => {
  it("auto-enrolls preset catalog entries via addSelectedToPool", async () => {
    apiState.presets = [
      { id: "preset-ocean", name: "Ocean Survey", minDepth: 0, maxDepth: 200, bbox: BBOX },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    expect(terrainStoreMock.addSelectedToPool).toHaveBeenCalledWith("preset-ocean", "preset");
  });
});

describe("DatasetPanel — proximity auto-registration: 10 user datasets with bbox", () => {
  it("enrolls all 10 user datasets with bbox in the proximity pool on mount", async () => {
    apiState.userDatasets = Array.from({ length: 10 }, (_, i) => ({
      id: `user-ds-${i}`,
      name: `Survey ${i}`,
      minDepth: 0,
      maxDepth: 100,
      createdAt: "2024-01-01T00:00:00Z",
      bbox: BBOX,
    }));

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    const enrolledIds = terrainStoreMock.addSelectedToPool.mock.calls.map((c) => c[0] as string);
    for (let i = 0; i < 10; i++) {
      expect(enrolledIds).toContain(`user-ds-${i}`);
    }
    expect(enrolledIds).toHaveLength(10);
    // Must use pool enrollment (no immediate activation), not addSelected.
    expect(terrainStoreMock.addSelected).not.toHaveBeenCalled();
  });

  it("enrolls all 10 datasets with source='user'", async () => {
    apiState.userDatasets = Array.from({ length: 10 }, (_, i) => ({
      id: `user-ds-${i}`,
      name: `Survey ${i}`,
      minDepth: 0,
      maxDepth: 100,
      createdAt: "2024-01-01T00:00:00Z",
      bbox: BBOX,
    }));

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    for (const call of terrainStoreMock.addSelectedToPool.mock.calls) {
      expect(call[1]).toBe("user");
    }
  });
});

describe("DatasetPanel — proximity auto-registration: proximityMode disabled", () => {
  beforeEach(() => {
    // Temporarily disable proximity mode via the mocked settings store.
    (useSettingsStore.getState() as unknown as Record<string, unknown>)["proximityMode"] = false;
  });

  afterEach(() => {
    // Restore to default (true) for subsequent tests.
    (useSettingsStore.getState() as unknown as Record<string, unknown>)["proximityMode"] = true;
  });

  it("does not auto-enroll any user dataset when proximityMode is false", async () => {
    apiState.userDatasets = [
      { id: "user-ds-a", name: "Survey A", minDepth: 0, maxDepth: 100, createdAt: "2024-01-01T00:00:00Z", bbox: BBOX },
      { id: "user-ds-b", name: "Survey B", minDepth: 0, maxDepth: 50, createdAt: "2024-01-01T00:00:00Z", bbox: BBOX },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    // No auto-registration when proximity mode is off.
    expect(terrainStoreMock.addSelectedToPool).not.toHaveBeenCalled();
    expect(terrainStoreMock.selectedIds).toHaveLength(0);
  });

  it("does not auto-enroll preset datasets when proximityMode is false", async () => {
    apiState.presets = [
      { id: "preset-bay", name: "Bay Survey", minDepth: 0, maxDepth: 200, bbox: BBOX },
    ];

    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    expect(terrainStoreMock.addSelectedToPool).not.toHaveBeenCalled();
  });
});

describe("DatasetPanel — proximity auto-registration: remount does not re-enroll", () => {
  it("does not call addSelectedToPool again for already-selected datasets when the panel remounts", async () => {
    apiState.presets = [
      { id: "preset-ocean", name: "Ocean Survey", minDepth: 0, maxDepth: 200, bbox: BBOX },
    ];
    apiState.userDatasets = [
      { id: "user-with-bbox", name: "User Survey", minDepth: 0, maxDepth: 100, createdAt: "2024-01-01T00:00:00Z", bbox: BBOX },
    ];

    // First mount — datasets enroll once.
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(React.createElement(DatasetPanel, {})));
    });

    expect(terrainStoreMock.addSelectedToPool).toHaveBeenCalledWith("preset-ocean", "preset");
    expect(terrainStoreMock.addSelectedToPool).toHaveBeenCalledWith("user-with-bbox", "user");
    const callCountAfterFirstMount = terrainStoreMock.addSelectedToPool.mock.calls.length;

    // Unmount (simulates navigation away).
    await act(async () => { unmount(); });

    // The terrainStore selectedIds now reflect what was enrolled (the mock's
    // addSelectedToPool implementation pushes IDs into selectedIds).
    terrainStoreMock.addSelectedToPool.mockClear();

    // Remount — datasets are already in selectedIds AND in autoRegisteredIds.
    // Neither re-enrollment path should fire.
    await act(async () => {
      render(React.createElement(DatasetPanel, {}));
    });

    // No new addSelectedToPool calls — the module-level autoRegisteredIds set
    // prevents re-enrollment on remount (the core bug fix).
    expect(terrainStoreMock.addSelectedToPool).not.toHaveBeenCalled();
    void callCountAfterFirstMount; // used above for assertion ordering
  });
});
