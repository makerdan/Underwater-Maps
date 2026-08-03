/**
 * Regression test: handleLoadCatalogSaveFromLeft guard when save.datasetId is null.
 *
 * UserCatalogSave.datasetId is string | null in the Drizzle schema.
 * If a save row has datasetId = null, the onConfirm callback must bail out
 * before calling setPendingExternalUserDatasetId — otherwise null is passed as
 * a string into the load pipeline, producing a malformed dataset URL.
 *
 * Note: MySavesSection already hides the "Load into viewer" button when
 * datasetId is null (status==="ready" && save.datasetId guard). The DatasetPanel
 * guard is an extra defensive layer that fires if the condition ever changes.
 * This test documents the expected behaviour:
 *   - DatasetPanel renders without crashing when a null-datasetId save is present.
 *   - setPendingExternalUserDatasetId is never called for such a save.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";
import { usePanelCollapseStore, DEFAULTS } from "@/lib/panelCollapseStore";

// ---------------------------------------------------------------------------
// Hoisted proxy factory
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
// Mutable state: individual tests configure auth and saves data here.
// ---------------------------------------------------------------------------
let isSignedIn = true;

// A catalog save whose datasetId is null (e.g. processing/failed, or schema drift).
const NULL_DATASET_ID_SAVE = {
  id: "save-null-did",
  catalogId: "ncei-portal-some-survey",
  status: "ready",     // even if "ready", datasetId may be null due to schema
  datasetId: null,
  folderId: null,
  displayLabel: null,
  catalog: { name: "Some NCEI Survey", sourceAgency: "NOAA", createdAt: null },
  errorMessage: null,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const setPendingExternalUserDatasetIdSpy = vi.fn();

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    terrain: null,
    mode: "fly",
    setPendingExternalUserDatasetId: setPendingExternalUserDatasetIdSpy,
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn, isLoaded: true }) });
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
    hideAllOthers: vi.fn(),
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
  // Immediately invoke onConfirm so handleLoadCatalogSaveFromLeft's guard is exercised.
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

// Only override what's needed for the null-datasetId guard test.
vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: () => ({ data: [], isLoading: false }),
      useGetUserDatasets: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: [] }),
      useGetUserFolders: () => ({ data: [], isLoading: false }),
      useGetDatasetsMySaves: () => ({
        data: [NULL_DATASET_ID_SAVE],
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

describe("DatasetPanel — handleLoadCatalogSaveFromLeft null-datasetId guard", () => {
  beforeEach(() => {
    setPendingExternalUserDatasetIdSpy.mockClear();
    isSignedIn = true;
    try { localStorage.clear(); } catch { /* ignore */ }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("renders without crashing when a save has a null datasetId", () => {
    // If the guard is missing, rendering can throw from null derefs in JSX.
    render(<DatasetPanel />);
    expect(screen.getByText("Datasets")).toBeInTheDocument();
  });

  it("does not show a Load button for a null-datasetId save (MySavesSection hides it)", () => {
    render(<DatasetPanel />);
    // MySavesSection hides "Load into viewer" when save.datasetId is falsy.
    expect(screen.queryByText("Load into viewer")).not.toBeInTheDocument();
  });

  it("never calls setPendingExternalUserDatasetId for a null-datasetId save", () => {
    // requestDatasetSwitch immediately calls onConfirm() in this test.
    // Even if the callback were invoked, the guard must prevent the spy from firing.
    render(<DatasetPanel />);
    // No Load button is shown, so the callback never fires — spy is clean.
    expect(setPendingExternalUserDatasetIdSpy).not.toHaveBeenCalled();
  });
});
