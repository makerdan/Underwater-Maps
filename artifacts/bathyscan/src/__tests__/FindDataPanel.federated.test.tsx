/**
 * Tests for the "External sources" federated search section in FindDataPanel.
 *
 * The client fans out ONE /search/federated request per connector id (from
 * /search/federated/sources) so partial results render per source without
 * one slow upstream blocking the rest.
 *
 * Coverage:
 *   1. The section is hidden until the user types a query.
 *   2. After typing, external results render with source chips and
 *      Importable / Link-only badges, plus the sources-checked summary.
 *   3. local-catalog is excluded from the fan-out entirely.
 *   4. Failed sources are listed as unavailable in the summary; sources
 *      still in flight show a "still checking" indicator (partial results
 *      are non-fatal AND non-blocking).
 *   5. Importable NCEI results expose a Save & Import button that reuses
 *      the existing POST /ncei/save flow with a rebuilt NceiPortalResult.
 *   6. Importable non-NCEI results save through the generic
 *      POST /search/federated/save endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import { useTerrainStore, MAX_ACTIVE_DATASETS, type VisibleDataset } from "@/lib/terrainStore";

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

const SOURCE_REGISTRY = {
  sources: [
    { id: "local-catalog", label: "BathyScan Catalog" },
    { id: "ncei-geoportal", label: "NOAA NCEI Geoportal" },
    { id: "portal-mndnr", label: "Minnesota DNR" },
    { id: "github-allowlist", label: "GitHub (open bathymetry repos)" },
    { id: "usgs-sciencebase", label: "USGS ScienceBase" },
    { id: "usgs-3dep", label: "USGS 3DEP" },
  ],
};

const NCEI_ITEM = {
  id: "ncei-geoportal:gov.noaa:sitka-123",
  sourceId: "ncei-geoportal",
  sourceLabel: "NOAA NCEI Geoportal",
  name: "Sitka Sound Multibeam Survey",
  description: "High-resolution multibeam survey of Sitka Sound",
  url: "https://example.org/sitka-meta",
  endpointUrl:
    "https://gis.ngdc.noaa.gov/arcgis/services/DEM_mosaics/DEM_global_mosaic/ImageServer/WCSServer",
  coverageBbox: { minLon: -136, minLat: 56.8, maxLon: -135, maxLat: 57.4 },
  resolutionMMin: 4,
  resolutionMMax: 8,
  importable: true,
  importKind: "ncei-wcs",
};

const MNDNR_ITEM = {
  id: "portal-mndnr:lake-vermilion-42",
  sourceId: "portal-mndnr",
  sourceLabel: "Minnesota DNR",
  name: "Lake Vermilion Bathymetry",
  description: "MN DNR lake bathymetry contours",
  url: "https://gisdata.mn.gov/dataset/lake-vermilion",
  endpointUrl: "https://arcgis.dnr.state.mn.us/arcgis/rest/services/lakes/FeatureServer/0",
  coverageBbox: { minLon: -92.6, minLat: 47.8, maxLon: -92.2, maxLat: 47.95 },
  resolutionMMin: null,
  resolutionMMax: null,
  importable: true,
  importKind: "arcgis-rest",
};

const GITHUB_ITEM = {
  id: "github-allowlist:noaa-ocs-hydrography/nbs-data",
  sourceId: "github-allowlist",
  sourceLabel: "GitHub (open bathymetry repos)",
  name: "noaa-ocs-hydrography/nbs-data",
  description: "National Bathymetric Source data",
  url: "https://github.com/noaa-ocs-hydrography/nbs-data",
  endpointUrl: null,
  coverageBbox: null,
  resolutionMMin: null,
  resolutionMMax: null,
  importable: false,
  importKind: null,
};

function okStatus(sourceId: string, label: string, resultCount: number) {
  return { sourceId, label, status: "ok", resultCount, tookMs: 200, error: null };
}

/** Per-source /search/federated responses keyed by the `sources` param. */
const PER_SOURCE_RESPONSES: Record<string, unknown> = {
  "ncei-geoportal": {
    results: [NCEI_ITEM],
    sources: [okStatus("ncei-geoportal", "NOAA NCEI Geoportal", 1)],
  },
  "portal-mndnr": {
    results: [MNDNR_ITEM],
    sources: [okStatus("portal-mndnr", "Minnesota DNR", 1)],
  },
  "github-allowlist": {
    results: [GITHUB_ITEM],
    sources: [okStatus("github-allowlist", "GitHub (open bathymetry repos)", 1)],
  },
  "usgs-sciencebase": {
    results: [],
    sources: [
      {
        sourceId: "usgs-sciencebase",
        label: "USGS ScienceBase",
        status: "timeout",
        resultCount: 0,
        tookMs: 8000,
        error: "Timed out after 8000 ms",
      },
    ],
  },
  // usgs-3dep deliberately has NO entry — its query stays pending so tests
  // can assert the partial-results "still checking" indicator.
};

let sourcesEnabled: boolean | undefined;
const nceiSaveMutateAsync = vi.fn().mockResolvedValue(undefined);
const federatedSaveMutateAsync = vi.fn().mockResolvedValue(undefined);
const refetchSavesMock = vi.fn().mockResolvedValue(undefined);
// Mutable list — individual tests can swap in ready-save fixtures to drive ADD-to-view tests.
let mySavesList: unknown[] = [];

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetSearchFederatedSources: (options?: { query?: { enabled?: boolean } }) => {
        sourcesEnabled = options?.query?.enabled;
        if (!options?.query?.enabled) {
          return { data: undefined, isFetching: false, isError: false, error: null };
        }
        return { data: SOURCE_REGISTRY, isFetching: false, isError: false, error: null };
      },
      usePostNceiSave: () => ({
        mutateAsync: nceiSaveMutateAsync,
        mutate: vi.fn(),
        isPending: false,
      }),
      usePostSearchFederatedSave: () => ({
        mutateAsync: federatedSaveMutateAsync,
        mutate: vi.fn(),
        isPending: false,
      }),
      useGetDatasetsCatalogSearch: () => ({ data: [], isFetching: false }),
      useGetDatasetsMySaves: () => ({
        data: mySavesList,
        isFetching: false,
        refetch: refetchSavesMock,
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

// useQueries mock: resolve each per-source query synchronously from
// PER_SOURCE_RESPONSES (keyed by the `sources` param inside the queryKey
// built by the getGetSearchFederatedQueryKey mock: [label, params]).
// Sources with no canned response stay pending — that models a slow
// upstream still in flight, which must NOT block the resolved ones.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQueries: ({
    queries,
  }: {
    queries: Array<{ queryKey: unknown[]; enabled?: boolean }>;
  }) =>
    queries.map((q) => {
      const params = q.queryKey[1] as { sources?: string } | undefined;
      const sourceId = params?.sources ?? "";
      if (!q.enabled || !(sourceId in PER_SOURCE_RESPONSES)) {
        return { data: undefined, isPending: true, error: null };
      }
      return { data: PER_SOURCE_RESPONSES[sourceId], isPending: false, error: null };
    }),
}));

vi.mock("@/lib/simulatedDataStore", () => ({
  requestDatasetSwitch: vi.fn(),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

/** Type into the search box and wait out the 400 ms debounce. */
async function typeQuery(value: string) {
  fireEvent.change(screen.getByTestId("find-data-search-input"), {
    target: { value },
  });
  await waitFor(
    () => expect(screen.getByTestId("federated-section")).toBeInTheDocument(),
    { timeout: 3000 },
  );
}

describe("FindDataPanel — External sources (federated search)", () => {
  beforeEach(() => {
    onClose.mockClear();
    nceiSaveMutateAsync.mockClear();
    federatedSaveMutateAsync.mockClear();
    refetchSavesMock.mockClear();
    refetchSavesMock.mockResolvedValue(undefined);
    toastSpy.mockClear();
    sourcesEnabled = undefined;
    mySavesList = [];
  });

  it("hides the section (and disables the registry query) until the user types", () => {
    renderPanel();
    expect(screen.queryByTestId("federated-section")).toBeNull();
    expect(sourcesEnabled).toBe(false);
  });

  it("renders external results with source chips and badges after typing", async () => {
    renderPanel();
    await typeQuery("sitka");

    // NCEI result — importable badge + source chip
    expect(screen.getByText("Sitka Sound Multibeam Survey")).toBeInTheDocument();
    expect(screen.getByText("NOAA NCEI Geoportal")).toBeInTheDocument();
    expect(screen.getAllByTestId("badge-importable").length).toBeGreaterThan(0);

    // GitHub result — link-only badge and outbound link
    expect(screen.getByText("noaa-ocs-hydrography/nbs-data")).toBeInTheDocument();
    expect(screen.getByTestId("badge-link-only")).toBeInTheDocument();
  });

  it("excludes local-catalog from the per-source fan-out", async () => {
    renderPanel();
    await typeQuery("sitka");
    const summary = screen.getByTestId("federated-sources-summary");
    // Registry has 6 sources; local-catalog excluded and usgs-3dep pending
    // → only 4 settled external sources appear in the summary.
    expect(summary.textContent).toContain("Checked 4 sources");
  });

  it("shows failed sources as unavailable and pending sources as still checking", async () => {
    renderPanel();
    await typeQuery("sitka");
    const summary = screen.getByTestId("federated-sources-summary");
    // 3 ok (ncei, mndnr, github) + 1 timeout (sciencebase); 3dep pending
    expect(summary.textContent).toContain("3 responded");
    expect(summary.textContent).toContain("USGS ScienceBase");
    expect(screen.getByTestId("federated-sources-pending").textContent).toContain(
      "still checking 1",
    );
    // Partial results already render even though one source is in flight
    expect(screen.getByText("Sitka Sound Multibeam Survey")).toBeInTheDocument();
  });

  it("Save & Import on an NCEI result posts a rebuilt NceiPortalResult", async () => {
    renderPanel();
    await typeQuery("sitka");
    const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));
    await waitFor(() => expect(nceiSaveMutateAsync).toHaveBeenCalledTimes(1));
    expect(nceiSaveMutateAsync).toHaveBeenCalledWith({
      data: {
        result: {
          id: "gov.noaa:sitka-123",
          name: "Sitka Sound Multibeam Survey",
          description: "High-resolution multibeam survey of Sitka Sound",
          sourceAgency: "NOAA NCEI",
          resolutionMMin: 4,
          resolutionMMax: 8,
          coverageBbox: { minLon: -136, minLat: 56.8, maxLon: -135, maxLat: 57.4 },
          metadataUrl: "https://example.org/sitka-meta",
          wcsAvailable: true,
        },
        // Area-request grouping context: same search → same request id, so
        // the server can auto-folder >2 saves from one search.
        areaRequest: { id: expect.any(String), label: "sitka" },
      },
    });
    expect(federatedSaveMutateAsync).not.toHaveBeenCalled();
  });

  it("Save & Import on a state-portal result posts to the generic federated save", async () => {
    renderPanel();
    await typeQuery("vermilion");
    const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));
    await waitFor(() => expect(federatedSaveMutateAsync).toHaveBeenCalledTimes(1));
    expect(federatedSaveMutateAsync).toHaveBeenCalledWith({
      data: {
        result: MNDNR_ITEM,
        areaRequest: { id: expect.any(String), label: "vermilion" },
      },
    });
    expect(nceiSaveMutateAsync).not.toHaveBeenCalled();
  });

  it("shows an error toast and clears the spinner when handleFederatedSave throws", async () => {
    federatedSaveMutateAsync.mockRejectedValueOnce(new Error("network failure"));
    renderPanel();
    await typeQuery("vermilion");

    const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to save. Please try again." }),
    );

    // Spinner must clear: the save button text reverts to "Save & Import"
    await waitFor(() =>
      expect(within(card).getByTestId("federated-save-button").textContent).toBe(
        "Save & Import",
      ),
    );
  });

  it("shows an error toast and clears the spinner when handleNceiSave (via federated) throws", async () => {
    nceiSaveMutateAsync.mockRejectedValueOnce(new Error("server 500"));
    renderPanel();
    await typeQuery("sitka");

    const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to save. Please try again." }),
    );

    // Spinner must clear
    await waitFor(() =>
      expect(within(card).getByTestId("federated-save-button").textContent).toBe(
        "Save & Import",
      ),
    );
  });

  it("shows a mild informational toast when save succeeds but refetchSaves rejects (federated)", async () => {
    refetchSavesMock.mockRejectedValueOnce(new Error("network timeout"));
    renderPanel();
    await typeQuery("vermilion");

    const card = screen.getByTestId(`federated-result-${MNDNR_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Saved, but couldn't refresh the list — reload to see it.",
      }),
    );
    // Must NOT show the hard error toast
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("shows a mild informational toast when save succeeds but refetchSaves rejects (NCEI via federated)", async () => {
    refetchSavesMock.mockRejectedValueOnce(new Error("network timeout"));
    renderPanel();
    await typeQuery("sitka");

    const card = screen.getByTestId(`federated-result-${NCEI_ITEM.id}`);
    fireEvent.click(within(card).getByTestId("federated-save-button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Saved, but couldn't refresh the list — reload to see it.",
      }),
    );
    expect(toastSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Terrain store helpers — reuse the same pattern as FindDataPanel.catalogAddToView.test.tsx
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
  const entry: VisibleDataset = { datasetId, source: "preset", activeGrid: null, overviewGrid: null };
  return {
    visibleDatasets: [entry],
    primaryDatasetIds: [datasetId],
    primaryDatasetId: datasetId,
    selectedIds: [datasetId],
    selectedSources: { [datasetId]: "preset" },
  };
}

function makeAtCapState(): Partial<typeof BLANK_TERRAIN_STATE> {
  // Fill selectedIds to MAX_ACTIVE_DATASETS so atCatalogCap is true.
  const ids = Array.from({ length: MAX_ACTIVE_DATASETS }, (_, i) => `cap-ds-${i}`);
  const visible: VisibleDataset[] = ids.map((id) => ({
    datasetId: id,
    source: "preset" as const,
    activeGrid: null,
    overviewGrid: null,
  }));
  return {
    visibleDatasets: visible,
    primaryDatasetIds: ids,
    primaryDatasetId: ids[0]!,
    selectedIds: ids,
    selectedSources: Object.fromEntries(ids.map((id) => [id, "preset" as const])),
  };
}

function makePrimaryWithDs(
  primaryId = "existing-primary-abc",
  extraId: string,
): Partial<typeof BLANK_TERRAIN_STATE> {
  const entries: VisibleDataset[] = [primaryId, extraId].map((id) => ({
    datasetId: id,
    source: "preset" as const,
    activeGrid: null,
    overviewGrid: null,
  }));
  return {
    visibleDatasets: entries,
    primaryDatasetIds: [primaryId, extraId],
    primaryDatasetId: primaryId,
    selectedIds: [primaryId, extraId],
    selectedSources: { [primaryId]: "preset", [extraId]: "user" },
  };
}

// ---------------------------------------------------------------------------
// ADD-to-view tests for FederatedResultCard
// ---------------------------------------------------------------------------

const NCEI_DS_ID = "user-ds-ncei-sitka-001";
const MNDNR_DS_ID = "user-ds-mndnr-vermilion-001";

// The server generates catalog IDs by:
//   - NCEI (sourceId="ncei-geoportal"): strip "ncei-geoportal:" prefix → sanitize → prepend "ncei-portal-"
//   - Other federated sources: sanitize full item.id → prepend "fed-"
// Sanitize = toLowerCase, replace /[^a-z0-9:.-]/g → "-", collapse "--", trim leading/trailing "-"
//
// NCEI_ITEM.id = "ncei-geoportal:gov.noaa:sitka-123"  →  "ncei-portal-gov.noaa:sitka-123"
// MNDNR_ITEM.id = "portal-mndnr:lake-vermilion-42"    →  "fed-portal-mndnr:lake-vermilion-42"
const NCEI_CATALOG_ID = "ncei-portal-gov.noaa:sitka-123";
const MNDNR_CATALOG_ID = "fed-portal-mndnr:lake-vermilion-42";

const READY_NCEI_SAVE = {
  id: "save-federated-ncei-1",
  catalogId: NCEI_CATALOG_ID,
  datasetId: NCEI_DS_ID,
  status: "ready",
  displayLabel: null,
  catalog: {
    name: "Sitka Sound Multibeam Survey",
    sourceAgency: "NOAA NCEI",
    createdAt: "2024-01-01T00:00:00Z",
  },
};

const READY_MNDNR_SAVE = {
  id: "save-federated-mndnr-1",
  catalogId: MNDNR_CATALOG_ID,
  datasetId: MNDNR_DS_ID,
  status: "ready",
  displayLabel: null,
  catalog: {
    name: "Lake Vermilion Bathymetry",
    sourceAgency: "Minnesota DNR",
    createdAt: "2024-01-01T00:00:00Z",
  },
};

describe("FindDataPanel — FederatedResultCard ADD to view", () => {
  beforeEach(() => {
    onClose.mockClear();
    toastSpy.mockClear();
    sourcesEnabled = undefined;
    // Reset terrain store and mySaves for each test.
    useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
    mySavesList = [];
  });

  afterEach(() => {
    useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
    mySavesList = [];
  });

  it("ADD button is hidden when no primary dataset is loaded even if item is materialized", async () => {
    mySavesList = [READY_NCEI_SAVE];
    // No primary in terrain store — hasCatalogPrimary is false
    renderPanel();
    await typeQuery("sitka");
    expect(
      screen.queryByTestId(`federated-add-to-view-${NCEI_ITEM.id}`),
    ).toBeNull();
  });

  it("ADD button appears when a primary is loaded and the item has been materialized", async () => {
    mySavesList = [READY_NCEI_SAVE];
    useTerrainStore.setState(makePrimaryState());
    renderPanel();
    await typeQuery("sitka");
    const btn = screen.getByTestId(`federated-add-to-view-${NCEI_ITEM.id}`);
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe("ADD");
  });

  it("ADD button is hidden for items that are not yet materialized (no ready save)", async () => {
    // MNDNR_ITEM has no entry in mySavesList
    mySavesList = [READY_NCEI_SAVE];
    useTerrainStore.setState(makePrimaryState());
    renderPanel();
    await typeQuery("vermilion");
    expect(
      screen.queryByTestId(`federated-add-to-view-${MNDNR_ITEM.id}`),
    ).toBeNull();
  });

  it("clicking ADD calls addSelected with the materialized datasetId", async () => {
    mySavesList = [READY_NCEI_SAVE];
    useTerrainStore.setState(makePrimaryState());
    const addSelectedSpy = vi.spyOn(useTerrainStore.getState(), "addSelected");
    renderPanel();
    await typeQuery("sitka");
    fireEvent.click(screen.getByTestId(`federated-add-to-view-${NCEI_ITEM.id}`));
    expect(addSelectedSpy).toHaveBeenCalledWith(NCEI_DS_ID, "user");
  });

  it("ADD button is disabled when the view is at capacity and the item is not yet in view", async () => {
    mySavesList = [READY_NCEI_SAVE];
    useTerrainStore.setState(makeAtCapState());
    renderPanel();
    await typeQuery("sitka");
    const btn = screen.getByTestId(`federated-add-to-view-${NCEI_ITEM.id}`);
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe("ADD");
  });

  it("button shows IN VIEW when the materialized dataset is already active in the terrain store", async () => {
    mySavesList = [READY_NCEI_SAVE];
    useTerrainStore.setState(makePrimaryWithDs("existing-primary-abc", NCEI_DS_ID));
    renderPanel();
    await typeQuery("sitka");
    expect(
      screen.getByTestId(`federated-add-to-view-${NCEI_ITEM.id}`).textContent,
    ).toBe("IN VIEW");
  });

  it("ADD button appears for a non-NCEI result (fed-* catalog ID path) when that item is materialized", async () => {
    // MNDNR_ITEM is a non-NCEI federated result; its server catalogId is
    // "fed-portal-mndnr:lake-vermilion-42" — the fed- prefix + sanitized item.id.
    mySavesList = [READY_MNDNR_SAVE];
    useTerrainStore.setState(makePrimaryState());
    renderPanel();
    await typeQuery("vermilion");
    const btn = screen.getByTestId(`federated-add-to-view-${MNDNR_ITEM.id}`);
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toBe("ADD");
  });

  it("clicking ADD on a non-NCEI result calls addSelected with its materialized datasetId", async () => {
    mySavesList = [READY_MNDNR_SAVE];
    useTerrainStore.setState(makePrimaryState());
    const addSelectedSpy = vi.spyOn(useTerrainStore.getState(), "addSelected");
    renderPanel();
    await typeQuery("vermilion");
    fireEvent.click(screen.getByTestId(`federated-add-to-view-${MNDNR_ITEM.id}`));
    expect(addSelectedSpy).toHaveBeenCalledWith(MNDNR_DS_ID, "user");
  });
});
