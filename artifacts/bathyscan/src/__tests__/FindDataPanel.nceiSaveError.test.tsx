/**
 * Error-path tests for handleNceiSave in FindDataPanel, plus direct-save
 * regression tests for the NceiResultCard "Save to Library" button.
 *
 * Coverage:
 *   1. When POST /ncei/save throws, an error toast is shown with a clear
 *      user-facing message.
 *   2. The saving spinner is cleared after the error (button returns to
 *      "Save to Library" state).
 *   3. An importable result can be saved without a loaded terrain grid.
 *   4. A result outside NCEI WCS coverage remains unavailable.
 *
 * Guard:
 *   These behavioral tests serve as the regression guard for the catch block
 *   in handleNceiSave — if the block is removed the toast assertion fails.
 *   The direct-save tests guard the NCEI Portal card wiring so a blank viewer
 *   does not prevent portal results from entering the existing save flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";

// ---------------------------------------------------------------------------
// Hoisted terrain state — mutable so individual tests can override it
// ---------------------------------------------------------------------------
type MockTerrainState = {
  activeGrid: unknown;
  visibleDatasets: unknown[];
  selectedIds: string[];
};

const mockTerrainState = vi.hoisted((): MockTerrainState => ({
  activeGrid: { datasetId: "test-grid", bbox: { minLon: -136, minLat: 56, maxLon: -135, maxLat: 57 } },
  visibleDatasets: [],
  selectedIds: [],
}));

vi.mock("@/lib/terrainStore", () => ({
  useTerrainStore: (sel: (s: MockTerrainState) => unknown) =>
    sel(mockTerrainState),
}));

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

const NCEI_RESULT = {
  id: "gov.noaa:sitka-456",
  name: "Sitka Sound Survey 2023",
  description: "Multibeam survey of Sitka Sound",
  sourceAgency: "NOAA NOS",
  resolutionMMin: 4,
  resolutionMMax: 8,
  coverageBbox: { minLon: -136, minLat: 56.8, maxLon: -135, maxLat: 57.4 },
  metadataUrl: "https://example.org/sitka-meta",
  wcsAvailable: true,
  modified: "2023-06-01",
};

// Stable reference — must NOT be an inline literal inside the mock factory.
// FindDataPanel checks `nceiPage === prevNceiPageRef.current` to gate the
// accumulate effect; a new array on every render call defeats that guard and
// triggers an infinite render loop → OOM.
const NCEI_RESULTS_PAGE = [NCEI_RESULT];
const NCEI_DATA_UPDATED_AT = 1700000000000; // stable number

const nceiSaveMutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      usePostNceiSave: () => ({
        mutateAsync: nceiSaveMutateAsync,
        mutate: vi.fn(),
        isPending: false,
      }),
      useGetNceiSearch: () => ({
        data: NCEI_RESULTS_PAGE,
        isFetching: false,
        isError: false,
        dataUpdatedAt: NCEI_DATA_UPDATED_AT,
      }),
      useGetDatasetsMySaves: () => ({
        data: [],
        isFetching: false,
        refetch: vi.fn().mockResolvedValue(undefined),
      }),
      useGetDatasetsCatalogSearch: () => ({ data: [], isFetching: false }),
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

/** Switch to the NCEI tab. */
function switchToNceiTab() {
  const nceiTab = screen.getByRole("button", { name: /NCEI Portal/i });
  fireEvent.click(nceiTab);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — handleNceiSave error path", () => {
  beforeEach(() => {
    onClose.mockClear();
    nceiSaveMutateAsync.mockClear();
    toastSpy.mockClear();
    NCEI_RESULT.wcsAvailable = true;
    // Restore a loaded terrain so error-path tests can actually click Save.
    mockTerrainState.activeGrid = {
      datasetId: "test-grid",
      bbox: { minLon: -136, minLat: 56, maxLon: -135, maxLat: 57 },
    } as unknown;
  });

  it("shows an error toast when the NCEI save mutation throws", async () => {
    nceiSaveMutateAsync.mockRejectedValueOnce(new Error("network error"));

    renderPanel();
    switchToNceiTab();

    // The NCEI result card must be visible
    await waitFor(() =>
      expect(screen.getByText("Sitka Sound Survey 2023")).toBeInTheDocument(),
    );

    // Click "Save to Library"
    const saveBtn = screen.getByRole("button", { name: /save to library/i });
    fireEvent.click(saveBtn);

    // Toast must fire with the user-facing error message
    await waitFor(() => expect(toastSpy).toHaveBeenCalledTimes(1));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to save. Please try again." }),
    );
  });

  it("clears the saving spinner after the NCEI save mutation throws", async () => {
    nceiSaveMutateAsync.mockRejectedValueOnce(new Error("server 503"));

    renderPanel();
    switchToNceiTab();

    await waitFor(() =>
      expect(screen.getByText("Sitka Sound Survey 2023")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /save to library/i });
    fireEvent.click(saveBtn);

    // After the error the button must revert from "Saving…" back to "Save to Library"
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /save to library/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Direct NCEI portal save tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — direct NCEI Portal saves", () => {
  beforeEach(() => {
    onClose.mockClear();
    nceiSaveMutateAsync.mockClear();
    toastSpy.mockClear();
    NCEI_RESULT.wcsAvailable = true;
  });

  it("saves an importable result from a blank viewer exactly once", async () => {
    mockTerrainState.activeGrid = null;

    renderPanel();
    switchToNceiTab();

    await waitFor(() =>
      expect(screen.getByText("Sitka Sound Survey 2023")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /save to library/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(nceiSaveMutateAsync).toHaveBeenCalledTimes(1));
    expect(nceiSaveMutateAsync).toHaveBeenCalledWith({
      data: { result: NCEI_RESULT },
    });
  });

  it("does not save a result outside NCEI WCS coverage", async () => {
    mockTerrainState.activeGrid = null;
    NCEI_RESULT.wcsAvailable = false;

    renderPanel();
    switchToNceiTab();

    await waitFor(() =>
      expect(screen.getByText("Sitka Sound Survey 2023")).toBeInTheDocument(),
    );

    const saveBtn = screen.getByRole("button", { name: /save to library/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(nceiSaveMutateAsync).not.toHaveBeenCalled();
  });
});
