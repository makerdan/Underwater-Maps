/**
 * Tests for the "ADD" / "IN VIEW" secondary action on catalog cards in FindDataPanel.
 *
 * Coverage:
 *   1. ADD button is hidden when no primary dataset is loaded.
 *   2. ADD button appears on preset-backed cards when a primary is already loaded.
 *   3. ADD button is absent on non-preset catalog entries (no presetId).
 *   4. Clicking ADD calls addSelected(presetId, "preset") on the terrain store.
 *   5. When the preset is already in the terrain store's selected pool the button
 *      shows "IN VIEW" and is disabled (cannot re-add).
 *   6. When selectedIds.length >= MAX_ACTIVE_DATASETS the button is disabled even
 *      though the entry is not yet in view (view is full).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import { useTerrainStore, MAX_ACTIVE_DATASETS } from "@/lib/terrainStore";
import type { VisibleDataset } from "@/lib/terrainStore";

// ---------------------------------------------------------------------------
// Hoisted proxy factory — identical pattern to the other FindDataPanel tests.
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isFetching: false, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
      isSuccess: false,
      variables: undefined,
    };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey")) {
          const label = k.replace(/^getGet/, "").replace(/QueryKey$/, "");
          return (...a: unknown[]) => [label, ...a];
        }
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k))
          return (...a: unknown[]) =>
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Catalog fixtures
// ---------------------------------------------------------------------------

/** A preset-backed catalog entry — id starts with "preset-". */
const PRESET_ENTRY = {
  id: "preset-thorne-bay-bathy",
  name: "Thorne Bay Bathymetry",
  dataType: "bathymetry",
  sourceAgency: "NOAA",
  waterType: "saltwater",
  description: "High-resolution bathymetry for Thorne Bay.",
  relevanceScore: 0.9,
  resolutionMMin: 2,
  resolutionMMax: 8,
  lastUpdated: "2024-01-15",
  createdAt: "2023-12-01",
  coverageBbox: null,
};
/** The presetId that FindDataPanel derives from the above entry id. */
const PRESET_ID = "thorne-bay-bathy";

/** A second preset entry — used to fill up the view cap. */
const PRESET_ENTRY_B = {
  id: "preset-sitka-sound-bathy",
  name: "Sitka Sound Bathymetry",
  dataType: "bathymetry",
  sourceAgency: "NOAA",
  waterType: "saltwater",
  description: "Multibeam bathymetry for Sitka Sound.",
  relevanceScore: 0.85,
  resolutionMMin: 4,
  resolutionMMax: 10,
  lastUpdated: "2024-02-01",
  createdAt: "2023-11-01",
  coverageBbox: null,
};

/** A catalog entry without a preset prefix — ADD button should never appear. */
const NON_PRESET_ENTRY = {
  id: "ncei-custom-survey-999",
  name: "Custom NCEI Survey",
  dataType: "bathymetry",
  sourceAgency: "NOAA NCEI",
  waterType: "saltwater",
  description: "A catalog entry without a preset-backed id.",
  relevanceScore: 0.7,
  resolutionMMin: null,
  resolutionMMax: null,
  lastUpdated: null,
  createdAt: null,
  coverageBbox: null,
};

// Mutable: individual tests swap this to control which results the API returns.
let catalogResults: unknown[] = [PRESET_ENTRY];

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasetsCatalogSearch: () => ({
        data: catalogResults,
        isFetching: false,
        dataUpdatedAt: 0,
      }),
      useGetDatasetsMySaves: () => ({
        data: [],
        isFetching: false,
        refetch: vi.fn().mockResolvedValue(undefined),
      }),
    }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
    setCatalogSourcedAt: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map(() => ({ data: undefined, isPending: true, error: null })),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLANK_TERRAIN_STATE = {
  visibleDatasets: [] as VisibleDataset[],
  primaryDatasetIds: [] as string[],
  primaryDatasetId: null as string | null,
  activeGrid: null,
  overviewGrid: null,
  selectedIds: [] as string[],
  selectedSources: {} as Record<string, "preset" | "user">,
  evictedId: null as string | null,
  autoEvictedId: null as string | null,
  multiDatasetMode: false,
};

function makePrimaryState(datasetId = "existing-primary-abc"): Partial<typeof BLANK_TERRAIN_STATE> {
  const entry: VisibleDataset = {
    datasetId,
    source: "preset",
    activeGrid: null,
    overviewGrid: null,
  };
  return {
    visibleDatasets: [entry],
    primaryDatasetIds: [datasetId],
    primaryDatasetId: datasetId,
    selectedIds: [datasetId],
    selectedSources: { [datasetId]: "preset" },
  };
}

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  onClose.mockClear();
  catalogResults = [PRESET_ENTRY];
  // Reset terrain store to empty state before each test.
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

afterEach(() => {
  // Restore terrain store to clean state so tests don't bleed into each other.
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — catalog ADD button", () => {
  it("ADD button is absent when no primary dataset is loaded", () => {
    // No visible datasets → hasPrimary = false.
    renderPanel();
    expect(
      screen.queryByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`),
    ).toBeNull();
  });

  it("ADD button appears on a preset-backed card when a primary is loaded", () => {
    useTerrainStore.setState(makePrimaryState());
    renderPanel();
    const btn = screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`);
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("ADD");
    expect(btn).not.toBeDisabled();
  });

  it("ADD button is absent for non-preset catalog entries even when a primary is loaded", () => {
    catalogResults = [NON_PRESET_ENTRY];
    useTerrainStore.setState(makePrimaryState());
    renderPanel();
    expect(
      screen.queryByTestId(`catalog-add-to-view-${NON_PRESET_ENTRY.id}`),
    ).toBeNull();
  });

  it("clicking ADD calls addSelected(presetId, 'preset') on the terrain store", () => {
    useTerrainStore.setState(makePrimaryState());
    const addSelectedSpy = vi.spyOn(useTerrainStore.getState(), "addSelected");
    renderPanel();

    const btn = screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`);
    fireEvent.click(btn);

    expect(addSelectedSpy).toHaveBeenCalledTimes(1);
    expect(addSelectedSpy).toHaveBeenCalledWith(PRESET_ID, "preset");
  });

  it("shows IN VIEW (disabled) when the preset is already in the selected pool", () => {
    // Put the preset itself into the selected pool as well as the primary.
    const primaryEntry: VisibleDataset = {
      datasetId: "existing-primary-abc",
      source: "preset",
      activeGrid: null,
      overviewGrid: null,
    };
    const presetEntry: VisibleDataset = {
      datasetId: PRESET_ID,
      source: "preset",
      activeGrid: null,
      overviewGrid: null,
    };
    useTerrainStore.setState({
      ...BLANK_TERRAIN_STATE,
      visibleDatasets: [primaryEntry, presetEntry],
      primaryDatasetIds: ["existing-primary-abc", PRESET_ID],
      primaryDatasetId: "existing-primary-abc",
      selectedIds: ["existing-primary-abc", PRESET_ID],
      selectedSources: { "existing-primary-abc": "preset", [PRESET_ID]: "preset" },
    });

    renderPanel();

    const btn = screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`);
    expect(btn).toHaveTextContent("IN VIEW");
    expect(btn).toBeDisabled();
  });

  it("shows ADD (disabled) when the terrain store is at MAX_ACTIVE_DATASETS cap", () => {
    // Fill selectedIds to the cap without including the card's preset.
    const makeEntry = (id: string): VisibleDataset => ({
      datasetId: id,
      source: "preset",
      activeGrid: null,
      overviewGrid: null,
    });
    const capIds = Array.from(
      { length: MAX_ACTIVE_DATASETS },
      (_, i) => `cap-dataset-${i}`,
    );
    useTerrainStore.setState({
      ...BLANK_TERRAIN_STATE,
      visibleDatasets: capIds.map(makeEntry),
      primaryDatasetIds: capIds,
      primaryDatasetId: capIds[0]!,
      selectedIds: capIds,
      selectedSources: Object.fromEntries(capIds.map((id) => [id, "preset"])),
    });

    renderPanel();

    const btn = screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`);
    expect(btn).toHaveTextContent("ADD");
    expect(btn).toBeDisabled();
  });

  it("ADD button does not call addSelected when already in view", () => {
    const primaryEntry: VisibleDataset = {
      datasetId: "existing-primary-abc",
      source: "preset",
      activeGrid: null,
      overviewGrid: null,
    };
    const presetEntry: VisibleDataset = {
      datasetId: PRESET_ID,
      source: "preset",
      activeGrid: null,
      overviewGrid: null,
    };
    useTerrainStore.setState({
      ...BLANK_TERRAIN_STATE,
      visibleDatasets: [primaryEntry, presetEntry],
      primaryDatasetIds: ["existing-primary-abc", PRESET_ID],
      primaryDatasetId: "existing-primary-abc",
      selectedIds: ["existing-primary-abc", PRESET_ID],
      selectedSources: { "existing-primary-abc": "preset", [PRESET_ID]: "preset" },
    });

    const addSelectedSpy = vi.spyOn(useTerrainStore.getState(), "addSelected");
    renderPanel();

    const btn = screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`);
    fireEvent.click(btn);

    expect(addSelectedSpy).not.toHaveBeenCalled();
  });

  it("shows ADD buttons for each preset card independently when a primary is loaded", () => {
    catalogResults = [PRESET_ENTRY, PRESET_ENTRY_B, NON_PRESET_ENTRY];
    useTerrainStore.setState(makePrimaryState());
    renderPanel();

    // Both preset cards should have ADD buttons.
    expect(
      screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`catalog-add-to-view-${PRESET_ENTRY_B.id}`),
    ).toBeInTheDocument();
    // Non-preset card must not.
    expect(
      screen.queryByTestId(`catalog-add-to-view-${NON_PRESET_ENTRY.id}`),
    ).toBeNull();
  });
});
