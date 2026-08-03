/**
 * Tests for `handleLoadUserDataset` in FindDataPanel — the "Load into viewer"
 * action for a user-uploaded dataset (not a catalog save).
 *
 * Coverage:
 *   1. Happy path: requestDatasetSwitch calls onConfirm →
 *      setPendingExternalUserDatasetId fires and onClose is called.
 *   2. Error path: requestDatasetSwitch throws →
 *      error toast fires and onClose is NOT called.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithProviders } from "./setup";
import { FindDataPanel } from "@/components/FindDataPanel";
import { useTerrainStore } from "@/lib/terrainStore";
import type { VisibleDataset } from "@/lib/terrainStore";
import { requestDatasetSwitch } from "@/lib/simulatedDataStore";

// ---------------------------------------------------------------------------
// Hoisted proxy factory — same pattern as the other FindDataPanel tests.
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
// Stable hoisted spies
// ---------------------------------------------------------------------------
const contextMocks = vi.hoisted(() => ({
  setPendingExternalUserDatasetId: vi.fn(),
  setCatalogSourcedAt: vi.fn(),
  setDatasetId: vi.fn(),
}));

const toastMock = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetDatasetsCatalogSearch: () => ({
        data: [],
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
    setDatasetId: contextMocks.setDatasetId,
    setPendingExternalUserDatasetId: contextMocks.setPendingExternalUserDatasetId,
    setCatalogSourcedAt: contextMocks.setCatalogSourcedAt,
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
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/help/HelpButton", () => ({
  HelpIcon: () => null,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

// MySavesSection mock — renders a button that fires onLoadUserDataset with a
// user-uploaded dataset id (not a catalog save). The handler under test is
// handleLoadUserDataset, not handleLoadCatalogSave.
vi.mock("@/components/MySavesSection", () => ({
  MySavesSection: ({
    onLoadUserDataset,
  }: {
    onLoadUserDataset?: (userDatasetId: string, createdAt?: string | null) => void;
  }) =>
    React.createElement(
      "button",
      {
        "data-testid": "mock-user-dataset-load-btn",
        onClick: () => onLoadUserDataset?.("user-upload-xyz-789", "2026-03-01T00:00:00Z"),
      },
      "Load uploaded dataset",
    ),
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

const onClose = vi.fn();

function renderPanel() {
  return renderWithProviders(<FindDataPanel onClose={onClose} />);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  onClose.mockClear();
  toastMock.mockClear();
  contextMocks.setPendingExternalUserDatasetId.mockClear();
  contextMocks.setCatalogSourcedAt.mockClear();
  contextMocks.setDatasetId.mockClear();
  vi.mocked(requestDatasetSwitch).mockReset();
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

afterEach(() => {
  useTerrainStore.setState({ ...BLANK_TERRAIN_STATE });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FindDataPanel — handleLoadUserDataset (My Saves tab)", () => {
  it("happy path: setPendingExternalUserDatasetId is called when onConfirm fires", async () => {
    vi.mocked(requestDatasetSwitch).mockImplementation(async (args) => {
      args.onConfirm();
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("find-data-my-saves-tab"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-user-dataset-load-btn"));
    });

    expect(contextMocks.setPendingExternalUserDatasetId).toHaveBeenCalledTimes(1);
    expect(contextMocks.setPendingExternalUserDatasetId).toHaveBeenCalledWith("user-upload-xyz-789");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("error path: shows error toast and does NOT call onClose when requestDatasetSwitch throws", async () => {
    vi.mocked(requestDatasetSwitch).mockRejectedValue(new Error("preflight network failure"));

    renderPanel();
    fireEvent.click(screen.getByTestId("find-data-my-saves-tab"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-user-dataset-load-btn"));
    });

    // Toast must fire with the expected message.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't load dataset — please try again.",
        variant: "destructive",
      }),
    );

    // Panel must stay open — onClose must NOT have been called.
    expect(onClose).not.toHaveBeenCalled();

    // Confirm callback must NOT have reached the app state setter.
    expect(contextMocks.setPendingExternalUserDatasetId).not.toHaveBeenCalled();
  });

  it("does NOT call setPendingExternalUserDatasetId when requestDatasetSwitch does not call onConfirm (dialog cancelled)", async () => {
    vi.mocked(requestDatasetSwitch).mockImplementation(async () => {
      // intentionally omit calling onConfirm
    });

    renderPanel();
    fireEvent.click(screen.getByTestId("find-data-my-saves-tab"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("mock-user-dataset-load-btn"));
    });

    expect(contextMocks.setPendingExternalUserDatasetId).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
