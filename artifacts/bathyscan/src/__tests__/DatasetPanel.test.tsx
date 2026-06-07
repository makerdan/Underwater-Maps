import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatasetPanel } from "@/components/DatasetPanel";

// ---------------------------------------------------------------------------
// Shared proxy factory — available to the synchronous vi.mock factory below.
//
// vi.mock() calls are hoisted before ES imports resolve, so helpers imported
// at the top of this file are NOT available inside a vi.mock() factory.
// vi.hoisted() is Vitest's escape hatch: its callback runs during the hoisting
// phase, before any imports or mock processing, making the returned value
// usable in the synchronous factory below.
//
// See src/__tests__/apiClientMock.ts for full documentation and the canonical
// copy of this pattern that other test files should follow.
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

const setDatasetIdMock = vi.fn();
const setTerrainMock = vi.fn();

const datasets = [
  {
    id: "alaska-fjord",
    name: "Alaska Fjord",
    description: "Deep saltwater fjord",
    minDepth: 5,
    maxDepth: 350,
    waterType: "saltwater",
  },
  {
    id: "lake-ray-roberts",
    name: "Lake Ray Roberts (TX)",
    description: "Lake Ray Roberts, Denton County, TX",
    minDepth: 0,
    maxDepth: 28,
    waterType: "freshwater",
  },
];

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: setDatasetIdMock,
    setTerrain: setTerrainMock,
    terrain: null,
    mode: "fly",
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
  };
  const state: SettingsMockState = { waterType: "saltwater", units: "metric" };
  const useSettingsStore = ((sel: (s: SettingsMockState) => unknown) =>
    sel(state)) as ((sel: (s: SettingsMockState) => unknown) => unknown) & {
    getState: () => SettingsMockState;
  };
  useSettingsStore.getState = () => state;
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

// Only the three hooks this test actually exercises need explicit overrides.
// Every other export from @workspace/api-client-react is auto-stubbed by the
// proxy above (query hooks → {data:undefined,isLoading:false}, mutation hooks
// → {mutate:noop,isPending:false}, query-key helpers → [...], URL helpers →
// "/api/mock/...").  When new endpoints are added to the generated client,
// this test continues to compile and run without any manual patching.
vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasets: (params?: {
        waterType?: "saltwater" | "freshwater";
      }) => ({
        data: params?.waterType
          ? datasets.filter((d) => d.waterType === params.waterType)
          : datasets,
        isLoading: false,
      }),
      useGetUserDatasets: () => ({ data: [], isLoading: false }),
      useGetMarkers: () => ({ data: [] }),
    }),
);

describe("DatasetPanel", () => {
  beforeEach(() => {
    setDatasetIdMock.mockClear();
    setTerrainMock.mockClear();
  });

  it("renders datasets matching the current waterType setting (default saltwater)", () => {
    render(<DatasetPanel />);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();
    // Depth range is shown in full-word form under the active units setting.
    expect(screen.getByText("5 meters to 350 meters")).toBeInTheDocument();
    expect(screen.getByTestId("btn-dataset-alaska-fjord")).toBeInTheDocument();
    // Freshwater dataset is filtered out under the default saltwater setting.
    expect(screen.queryByText("Lake Michigan")).not.toBeInTheDocument();
  });

  it("clicking a dataset triggers loading state (pending fetch)", () => {
    render(<DatasetPanel />);
    const btn = screen.getByTestId("btn-dataset-alaska-fjord");
    fireEvent.click(btn);
    // The LoadingDial should mount for the clicked dataset's row.
    expect(screen.getByTestId("loading-dial")).toBeInTheDocument();
  });

  it("collapses and expands dataset list when header is clicked", () => {
    render(<DatasetPanel />);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();

    const header = screen.getByText("Datasets").closest("button")!;
    fireEvent.click(header);
    expect(screen.queryByText("Alaska Fjord")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText("Alaska Fjord")).toBeInTheDocument();
  });

  it("renders the upload dropzone area after expanding the upload section", () => {
    render(<DatasetPanel />);
    expect(screen.queryByTestId("dropzone-terrain")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/UPLOAD DATASET\(S\)/));
    expect(screen.getByTestId("dropzone-terrain")).toBeInTheDocument();
  });
});
