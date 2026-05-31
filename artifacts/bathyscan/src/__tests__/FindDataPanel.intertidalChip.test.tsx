/**
 * Tests for the "Intertidal / Shoreline" filter chip in FindDataPanel.
 *
 * Coverage:
 *   1. The chip is present in the filter bar.
 *   2. Clicking it narrows the results list to only entries whose id is in
 *      INTERTIDAL_CATALOG_IDS (client-side filter — "intertidal" is never
 *      forwarded to the catalog search API).
 *   3. Clicking the "habitat" chip does NOT exclude entries that happen to be
 *      in INTERTIDAL_CATALOG_IDS — the intertidal badge is decorative; the
 *      habitat filter is purely server-side and must not regress.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted proxy factory — must be defined before any imports are processed.
// (See artifacts/bathyscan/src/__tests__/apiClientMock.ts for full docs.)
// ---------------------------------------------------------------------------
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: [], isFetching: false, isLoading: false, isError: false };
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
            `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Catalog fixture
//
// Three catalog entries:
//   • adfg-clam   — an intertidal entry (id in INTERTIDAL_CATALOG_IDS)
//   • kelp-habitat — a regular "habitat" entry (not intertidal)
//   • alaska-bathy — a "bathymetry" entry (neither)
// ---------------------------------------------------------------------------
const INTERTIDAL_ENTRY = {
  id: "adfg-intertidal-clam-habitat-se-alaska",
  name: "ADF&G Intertidal Clam Habitat",
  dataType: "habitat",
  sourceAgency: "ADF&G",
  waterType: "saltwater",
  description: "Intertidal clam habitat along SE Alaska shores.",
  relevanceScore: 0.9,
  resolutionMMin: null,
  resolutionMMax: null,
  lastUpdated: null,
};

const HABITAT_ENTRY = {
  id: "pacific-kelp-habitat",
  name: "Pacific Kelp Habitat",
  dataType: "habitat",
  sourceAgency: "NOAA",
  waterType: "saltwater",
  description: "Kelp forest habitat data.",
  relevanceScore: 0.8,
  resolutionMMin: null,
  resolutionMMax: null,
  lastUpdated: null,
};

const BATHY_ENTRY = {
  id: "alaska-bathy-2024",
  name: "Alaska Bathymetry 2024",
  dataType: "bathymetry",
  sourceAgency: "NOAA",
  waterType: "saltwater",
  description: "High-resolution bathymetry for Alaska.",
  relevanceScore: 0.7,
  resolutionMMin: 2,
  resolutionMMax: 10,
  lastUpdated: "2024-03-01",
};

// The catalog search hook is called with { q, dataType }. We track the most
// recent params so each test can control what gets returned.
let catalogSearchParams: { q?: string; dataType?: string } = {};

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasetsCatalogSearch: (params: {
        q?: string;
        dataType?: string;
      }) => {
        // Capture the params so assertions can inspect them if needed.
        catalogSearchParams = params ?? {};

        // Simulate server-side dataType filtering:
        //   "intertidal" is never forwarded (component sets dataType=undefined),
        //   so the server returns all three entries for that case too.
        if (params?.dataType === "bathymetry") {
          return { data: [BATHY_ENTRY], isFetching: false };
        }
        if (params?.dataType === "habitat") {
          // Server returns all habitat-typed entries, including the intertidal one.
          return {
            data: [INTERTIDAL_ENTRY, HABITAT_ENTRY],
            isFetching: false,
          };
        }
        // No server-side filter → return everything.
        return {
          data: [INTERTIDAL_ENTRY, HABITAT_ENTRY, BATHY_ENTRY],
          isFetching: false,
        };
      },
      useGetDatasetsMySaves: () => ({ data: [], isFetching: false }),
    }),
);

vi.mock("@/lib/context", () => ({
  useAppState: () => ({
    datasetId: null,
    setDatasetId: vi.fn(),
    setPendingExternalUserDatasetId: vi.fn(),
  }),
}));

vi.mock("@/lib/clerkCompat", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

function getChip(label: string | RegExp) {
  return screen.getByRole("button", { name: label });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — Intertidal / Shoreline filter chip", () => {
  beforeEach(() => {
    onClose.mockClear();
    catalogSearchParams = {};
  });

  it("renders the Intertidal / Shoreline chip in the filter bar", () => {
    renderPanel();
    const chip = getChip(/Intertidal \/ Shoreline/i);
    expect(chip).toBeInTheDocument();
  });

  it("clicking the chip narrows results to only INTERTIDAL_CATALOG_IDS entries", () => {
    renderPanel();

    // Before clicking — all three entries are visible (no filter active).
    expect(screen.getByText("ADF&G Intertidal Clam Habitat")).toBeInTheDocument();
    expect(screen.getByText("Pacific Kelp Habitat")).toBeInTheDocument();
    expect(screen.getByText("Alaska Bathymetry 2024")).toBeInTheDocument();

    // Click the Intertidal / Shoreline chip.
    fireEvent.click(getChip(/Intertidal \/ Shoreline/i));

    // Only the intertidal entry should remain visible.
    expect(screen.getByText("ADF&G Intertidal Clam Habitat")).toBeInTheDocument();
    // The other entries must not appear.
    expect(screen.queryByText("Pacific Kelp Habitat")).not.toBeInTheDocument();
    expect(screen.queryByText("Alaska Bathymetry 2024")).not.toBeInTheDocument();
  });

  it("the intertidal chip does NOT forward dataType=intertidal to the catalog API", () => {
    renderPanel();
    fireEvent.click(getChip(/Intertidal \/ Shoreline/i));
    // The component should send undefined (not "intertidal") as the dataType
    // param — "intertidal" is a client-side-only concept.
    expect(catalogSearchParams.dataType).toBeUndefined();
  });

  it("the habitat chip still shows intertidal entries alongside other habitat datasets", () => {
    renderPanel();

    // Click the habitat chip — server responds with both habitat entries
    // (including the intertidal one).
    fireEvent.click(getChip(/🐟 habitat/i));

    // Both habitat entries should be visible.
    expect(screen.getByText("ADF&G Intertidal Clam Habitat")).toBeInTheDocument();
    expect(screen.getByText("Pacific Kelp Habitat")).toBeInTheDocument();
    // The bathymetry entry should not appear (server filtered it out).
    expect(screen.queryByText("Alaska Bathymetry 2024")).not.toBeInTheDocument();
  });

  it("excludes a habitat-typed entry whose id is NOT in INTERTIDAL_CATALOG_IDS when the chip is active", () => {
    // HABITAT_ENTRY has dataType='habitat' but its id ('pacific-kelp-habitat')
    // is not in INTERTIDAL_CATALOG_IDS.  The chip must filter by ID membership
    // only — dataType alone must never be enough to pass the guard.
    renderPanel();

    fireEvent.click(getChip(/Intertidal \/ Shoreline/i));

    // The intertidal entry (id in set) should appear.
    expect(screen.getByText("ADF&G Intertidal Clam Habitat")).toBeInTheDocument();
    // The habitat entry (id NOT in set) must be absent even though its
    // dataType is 'habitat' — same type as the intertidal entry above.
    expect(screen.queryByText("Pacific Kelp Habitat")).not.toBeInTheDocument();
  });

  it("clicking Intertidal then All restores the full result list", () => {
    renderPanel();

    fireEvent.click(getChip(/Intertidal \/ Shoreline/i));
    expect(screen.queryByText("Pacific Kelp Habitat")).not.toBeInTheDocument();

    fireEvent.click(getChip(/^All$/i));

    expect(screen.getByText("ADF&G Intertidal Clam Habitat")).toBeInTheDocument();
    expect(screen.getByText("Pacific Kelp Habitat")).toBeInTheDocument();
    expect(screen.getByText("Alaska Bathymetry 2024")).toBeInTheDocument();
  });
});
