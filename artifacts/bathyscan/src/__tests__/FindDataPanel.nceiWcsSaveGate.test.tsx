/**
 * Regression guard: the Save button on NCEI WCS catalog entries (id starts
 * with "ncei-") must be disabled when no terrain is currently loaded in the
 * viewer (terrainStore.activeGrid === null).
 *
 * Coverage:
 *   1. Save button is disabled on an ncei-* catalog entry when activeGrid is null.
 *   2. A tooltip message "Load a terrain in this area first, then save to
 *      download it." is rendered (via aria / accessible label) on the disabled
 *      button's wrapper.
 *   3. Clicking the disabled button does NOT invoke the save mutation.
 *   4. Save button is enabled on the same ncei-* entry once activeGrid is set.
 *   5. Non-NCEI catalog entries (no "ncei-" prefix) are NOT affected by the gate.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import { useTerrainStore } from "@/lib/terrainStore";
import type { TerrainData } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Hoisted proxy factory
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
// Fixtures
// ---------------------------------------------------------------------------

/** An NCEI WCS catalog entry whose save requires an active terrain bbox. */
const NCEI_ENTRY = {
  id: "ncei-bag-mosaic-se-alaska",
  name: "SE Alaska NCEI BAG Mosaic",
  dataType: "bathymetry",
  sourceAgency: "NOAA NCEI",
  waterType: "saltwater",
  description: "NCEI WCS BAG mosaic for Southeast Alaska.",
  relevanceScore: 0.95,
  resolutionMMin: 8,
  resolutionMMax: 16,
  lastUpdated: "2024-06-01",
  createdAt: "2023-11-01",
  coverageBbox: { minLon: -140, minLat: 54, maxLon: -130, maxLat: 60 },
};

/** A regular non-NCEI catalog entry — save gate must NOT apply. */
const REGULAR_ENTRY = {
  id: "adfg-intertidal-bathy-001",
  name: "ADF&G Coastal Survey",
  dataType: "bathymetry",
  sourceAgency: "ADF&G",
  waterType: "saltwater",
  description: "Regular catalog entry not prefixed with ncei-.",
  relevanceScore: 0.8,
  resolutionMMin: 4,
  resolutionMMax: 8,
  lastUpdated: null,
  createdAt: null,
  coverageBbox: null,
};

/** Minimal stub for an active terrain grid (all required TerrainData fields). */
const STUB_ACTIVE_GRID: TerrainData = {
  datasetId: "ncei-bag-mosaic-se-alaska",
  name: "SE Alaska NCEI BAG Mosaic",
  waterType: "saltwater",
  resolution: 8,
  width: 10,
  height: 10,
  depths: Array.from({ length: 100 }, (_, i) => i * 0.1),
  minDepth: 0,
  maxDepth: 9.9,
  minLon: -137,
  maxLon: -135,
  minLat: 56,
  maxLat: 58,
  centerLon: -136,
  centerLat: 57,
};

// ---------------------------------------------------------------------------
// Mutable: tests control what the catalog search returns.
// ---------------------------------------------------------------------------
let catalogResults: unknown[] = [NCEI_ENTRY];

const saveMutateAsync = vi.fn().mockResolvedValue(undefined);

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
      usePostDatasetsCatalogIdSave: () => ({
        mutateAsync: saveMutateAsync,
        mutate: vi.fn(),
        isPending: false,
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
  ViewscreenTooltip: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) => <span title={label}>{children}</span>,
}));

// ---------------------------------------------------------------------------
// Blank terrain state helper
// ---------------------------------------------------------------------------
const BLANK_TERRAIN_STATE = {
  visibleDatasets: [],
  primaryDatasetIds: [],
  primaryDatasetId: null,
  activeGrid: null,
  overviewGrid: null,
  evictedId: null,
  autoEvictedId: null,
  selectedIds: [],
  selectedSources: {},
  multiDatasetMode: false,
  overviewFetchErrorIds: [],
};

const onClose = vi.fn();

async function renderOnSearchTab() {
  const result = renderWithProviders(<FindDataPanel onClose={onClose} />);
  // Panel opens on the Search tab by default; just wait for render.
  return result;
}

beforeEach(() => {
  onClose.mockClear();
  saveMutateAsync.mockClear();
  catalogResults = [NCEI_ENTRY];
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

afterEach(() => {
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — NCEI WCS save gate", () => {
  it("Save button on ncei-* entry is disabled when no terrain is loaded", async () => {
    // activeGrid is null (blank terrain state set in beforeEach).
    await renderOnSearchTab();

    await waitFor(() =>
      expect(screen.getByText("SE Alaska NCEI BAG Mosaic")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
  });

  it("disabled Save button shows the terrain-required tooltip", async () => {
    await renderOnSearchTab();

    await waitFor(() =>
      expect(screen.getByText("SE Alaska NCEI BAG Mosaic")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    // The tooltip wrapper receives a `title` attribute via our mock.
    const tooltipWrapper = saveBtn.closest("[title]");
    expect(tooltipWrapper).not.toBeNull();
    expect(tooltipWrapper!.getAttribute("title")).toBe(
      "Load a terrain in this area first, then save to download it.",
    );
  });

  it("clicking the disabled Save button does not invoke the save mutation", async () => {
    await renderOnSearchTab();

    await waitFor(() =>
      expect(screen.getByText("SE Alaska NCEI BAG Mosaic")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    fireEvent.click(saveBtn);

    expect(saveMutateAsync).not.toHaveBeenCalled();
  });

  it("Save button becomes enabled once activeGrid is populated", async () => {
    await renderOnSearchTab();

    await waitFor(() =>
      expect(screen.getByText("SE Alaska NCEI BAG Mosaic")).toBeInTheDocument(),
    );

    // Initially disabled.
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeDisabled();

    // Simulate terrain load.
    await act(async () => {
      useTerrainStore.setState({
        ...BLANK_TERRAIN_STATE,
        activeGrid: STUB_ACTIVE_GRID,
        visibleDatasets: [
          {
            datasetId: STUB_ACTIVE_GRID.datasetId,
            source: "preset",
            activeGrid: STUB_ACTIVE_GRID,
            overviewGrid: null,
          },
        ],
        primaryDatasetId: STUB_ACTIVE_GRID.datasetId,
        primaryDatasetIds: [STUB_ACTIVE_GRID.datasetId],
      });
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Save$/i })).not.toBeDisabled(),
    );
  });

  it("non-ncei catalog entries are NOT affected by the terrain gate", async () => {
    catalogResults = [REGULAR_ENTRY];
    // activeGrid is null — but this entry doesn't start with "ncei-".

    await renderOnSearchTab();

    await waitFor(() =>
      expect(screen.getByText("ADF&G Coastal Survey")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    // Must be enabled even with no terrain loaded.
    expect(saveBtn).not.toBeDisabled();
  });
});
