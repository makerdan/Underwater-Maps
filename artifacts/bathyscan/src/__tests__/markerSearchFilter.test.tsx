/**
 * Unit tests for marker search/filter logic in DatasetPanel.
 *
 * Covers:
 *  - Text search filters by label
 *  - Text search filters by notes
 *  - Type filter hides non-matching markers
 *  - Text + type filters compose (AND semantics)
 *  - "No markers match" message shows when all are filtered out
 *  - Edit button opens markerEditStore with the correct marker
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { DatasetPanel } from "@/components/DatasetPanel";
import { useMarkerEditStore } from "@/lib/markerEditStore";

// ── Shared proxy factory (hoisted so vi.mock factories can reference it) ────
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined };
  }
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
          return (...a: unknown[]) => `/api/mock/${a.filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

// ── Sample terrain + markers ────────────────────────────────────────────────
const TERRAIN = {
  datasetId: "alaska-fjord",
  minDepth: 5,
  maxDepth: 350,
  waterType: "saltwater",
  rows: 10,
  cols: 10,
  lonMin: -150,
  lonMax: -140,
  latMin: 58,
  latMax: 62,
  cellSizeLon: 0.1,
  cellSizeLat: 0.1,
  depths: new Array(100).fill(100),
};

const MARKERS = [
  { id: "m1", datasetId: "alaska-fjord", type: "fish",      label: "Big school near ridge", notes: "Very active",   lon: -145, lat: 60, depth: 80 },
  { id: "m2", datasetId: "alaska-fjord", type: "coral",     label: "Coral formation",        notes: "North face",    lon: -145, lat: 61, depth: 120 },
  { id: "m3", datasetId: "alaska-fjord", type: "shipwreck", label: "Old trawler",             notes: "Rusty hull",    lon: -144, lat: 60, depth: 200 },
  { id: "m4", datasetId: "alaska-fjord", type: "custom",    label: "Custom point",           notes: "ridge area",    lon: -143, lat: 59, depth: 50 },
];

// ── Store mocks ─────────────────────────────────────────────────────────────
vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: "alaska-fjord",
    setDatasetId: vi.fn(),
    setTerrain: vi.fn(),
    terrain: TERRAIN,
    mode: "fly",
    pendingExternalUserDatasetId: null,
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: false, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: class { fetchQuery = vi.fn(); invalidateQueries = vi.fn(); },
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

vi.mock("@/lib/uiStore", () => {
  const state = {
    setPendingDropIn: vi.fn(),
    setMarkerFormOpen: vi.fn(),
    markerFormPrefill: null,
  };
  return {
    useUiStore: Object.assign(
      (sel: (s: typeof state) => unknown) => sel(state),
      { getState: () => state },
    ),
  };
});

vi.mock("@/lib/classificationStore", () => {
  const state = {
    source: null,
    currentSubstrate: null,
    clearZoneMap: vi.fn(),
    classify: vi.fn(),
  };
  const useClassificationStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useClassificationStore };
});

vi.mock("@/lib/settingsStore", () => {
  type State = {
    waterType: "saltwater" | "freshwater";
    units: "metric" | "imperial";
    bookmarks: Record<string, unknown[]>;
    renameBookmark: () => void;
    deleteBookmark: () => void;
  };
  const state: State = {
    waterType: "saltwater",
    units: "metric",
    bookmarks: {},
    renameBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
  };
  const useSettingsStore = Object.assign(
    (sel: (s: State) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useSettingsStore };
});

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: ({ onConfirm }: { onConfirm: () => void }) => { onConfirm(); },
}));

vi.mock("@/lib/offlineStore", () => ({
  useOfflineStore: (sel: (s: { isOnline: boolean }) => unknown) => sel({ isOnline: true }),
}));

vi.mock("@/lib/activeLoadStore", () => ({
  useActiveLoadStore: Object.assign(
    (_sel: unknown) => undefined,
    { getState: () => ({ start: vi.fn(), fail: vi.fn(), complete: vi.fn(), active: null, update: vi.fn() }) },
  ),
}));

vi.mock("@/hooks/useUndoableMarkerDelete", () => ({
  useUndoableMarkerDelete: () => ({ requestDelete: vi.fn(), isDeletePending: vi.fn().mockReturnValue(false) }),
}));

// markerEditStore uses the real Zustand store so we can inspect calls.
// We do NOT mock it here — we read its state directly after interactions.

vi.mock("@/lib/panelCollapseStore", () => {
  const collapsed: Record<string, boolean> = {
    datasets: false,
    markersAccordion: false,
    uploadTerrainAccordion: true,
  };
  const store = {
    collapsed,
    toggle: vi.fn(),
    setCollapsed: (id: string, value: boolean) => { collapsed[id] = value; },
  };
  const usePanelCollapseStore = Object.assign(
    (sel: (s: typeof store) => unknown) => sel(store),
    { getState: () => store },
  );
  return { usePanelCollapseStore };
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetDatasets: () => ({
      data: [
        { id: "alaska-fjord", name: "Alaska Fjord", minDepth: 5, maxDepth: 350, waterType: "saltwater" },
      ],
      isLoading: false,
    }),
    useGetUserDatasets: () => ({ data: [], isLoading: false }),
    useGetMarkers: () => ({ data: MARKERS }),
    MarkerInputType: { custom: "custom" },
  }),
);

// ── Tests ───────────────────────────────────────────────────────────────────
describe("DatasetPanel — marker search/filter", () => {
  beforeEach(() => {
    // Reset markerEditStore between tests
    useMarkerEditStore.getState().close();
  });

  function openPanel() {
    renderWithProviders(<DatasetPanel />);
    // Markers section is already open (markersAccordion: false in mock).
    // But the section only renders when markerDatasetId is set (terrain exists).
    // Confirm the section header is visible:
    expect(screen.getByText(/MARKERS/)).toBeInTheDocument();
  }

  it("shows all markers when no filter or search is active", () => {
    openPanel();
    expect(screen.getByText("Big school near ridge")).toBeInTheDocument();
    expect(screen.getByText("Coral formation")).toBeInTheDocument();
    expect(screen.getByText("Old trawler")).toBeInTheDocument();
    expect(screen.getByText("Custom point")).toBeInTheDocument();
  });

  it("text search filters markers by label (case-insensitive)", () => {
    openPanel();
    const input = screen.getByTestId("marker-search-input");

    fireEvent.change(input, { target: { value: "coral" } });

    expect(screen.getByText("Coral formation")).toBeInTheDocument();
    expect(screen.queryByText("Big school near ridge")).not.toBeInTheDocument();
    expect(screen.queryByText("Old trawler")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom point")).not.toBeInTheDocument();
  });

  it("text search filters markers by notes (case-insensitive)", () => {
    openPanel();
    const input = screen.getByTestId("marker-search-input");

    fireEvent.change(input, { target: { value: "ridge" } });

    // "Big school near ridge" matches by label; "Custom point" matches by notes ("ridge area")
    expect(screen.getByText("Big school near ridge")).toBeInTheDocument();
    expect(screen.getByText("Custom point")).toBeInTheDocument();
    expect(screen.queryByText("Coral formation")).not.toBeInTheDocument();
    expect(screen.queryByText("Old trawler")).not.toBeInTheDocument();
  });

  it("type filter shows only markers matching the selected type", () => {
    openPanel();

    const fishBtn = screen.getByTestId("marker-type-filter-fish");
    fireEvent.click(fishBtn);

    expect(screen.getByText("Big school near ridge")).toBeInTheDocument();
    expect(screen.queryByText("Coral formation")).not.toBeInTheDocument();
    expect(screen.queryByText("Old trawler")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom point")).not.toBeInTheDocument();
  });

  it("clicking an active type filter again clears it (toggle off)", () => {
    openPanel();

    const fishBtn = screen.getByTestId("marker-type-filter-fish");
    fireEvent.click(fishBtn);
    // Only fish visible
    expect(screen.queryByText("Coral formation")).not.toBeInTheDocument();

    // Click again to clear
    fireEvent.click(fishBtn);
    // All markers visible again
    expect(screen.getByText("Coral formation")).toBeInTheDocument();
    expect(screen.getByText("Old trawler")).toBeInTheDocument();
  });

  it("text search + type filter compose with AND semantics", () => {
    openPanel();

    // Apply type filter: fish
    fireEvent.click(screen.getByTestId("marker-type-filter-fish"));
    // Apply text search that doesn't match the fish marker's label/notes
    const input = screen.getByTestId("marker-search-input");
    fireEvent.change(input, { target: { value: "trawler" } });

    // No markers match both fish type AND "trawler" text
    expect(screen.queryByText("Big school near ridge")).not.toBeInTheDocument();
    expect(screen.queryByText("Old trawler")).not.toBeInTheDocument();
    expect(screen.getByText("No markers match the current filter")).toBeInTheDocument();
  });

  it("shows 'no match' message when all markers are filtered out", () => {
    openPanel();

    const input = screen.getByTestId("marker-search-input");
    fireEvent.change(input, { target: { value: "xyznotfound" } });

    expect(screen.getByText("No markers match the current filter")).toBeInTheDocument();
  });

  it("'✕ all' button clears the active type filter", () => {
    openPanel();

    fireEvent.click(screen.getByTestId("marker-type-filter-shipwreck"));
    // Clear button appears
    const clearBtn = screen.getByText(/✕ all/);
    fireEvent.click(clearBtn);

    // All markers visible again
    expect(screen.getByText("Big school near ridge")).toBeInTheDocument();
    expect(screen.getByText("Coral formation")).toBeInTheDocument();
  });

  it("clicking the edit pencil on a marker opens markerEditStore with that marker", () => {
    openPanel();

    // The edit buttons are opacity-0 in CSS but still in the DOM and interactive
    const editButtons = screen.getAllByRole("button", { hidden: true }).filter(
      (el) => el.textContent === "✏",
    );

    // Click the edit button on the first marker (Big school near ridge → m1)
    expect(editButtons.length).toBeGreaterThan(0);
    fireEvent.click(editButtons[0]!);

    const stored = useMarkerEditStore.getState().marker;
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe("m1");
    expect(stored?.label).toBe("Big school near ridge");
    expect(stored?.type).toBe("fish");
  });
});
