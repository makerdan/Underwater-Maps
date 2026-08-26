/**
 * Unit tests for CollectionsSection + AddToCollectionDialog.
 *
 * Covers (per task "User-defined dataset collections"):
 *   1. Section hidden entirely when signed out.
 *   2. Empty state when the user has no collections.
 *   3. Collections listed sorted by name with member counts; expanding a
 *      collection lists its members with resolved names (both kinds).
 *   4. Create flow: "+ new" → input → Create calls the POST mutation and
 *      invalidates the collections query.
 *   5. Duplicate-name create shows a friendly inline error.
 *   6. Rename flow: ✎ → inline input → Enter calls the rename mutation.
 *   7. Delete flow: ✕ → confirm dialog (copy says datasets stay) → confirm
 *      calls the DELETE mutation. Cancel closes without deleting.
 *   8. Removing a member calls the member-DELETE mutation and never any
 *      dataset-delete mutation (regression guard).
 *   9. Expanded empty collection shows the per-collection empty state.
 *  10. AddToCollectionDialog: pick an existing collection → one add-member
 *      call per target; create-new-name path creates first, then adds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { renderWithProviders } from "./setup";
import { CollectionsSection, AddToCollectionDialog } from "@/components/CollectionsSection";
import { useSpecialCollectionStore } from "@/lib/specialCollectionStore";
import { useTerrainStore } from "@/lib/terrainStore";
import { useUiStore } from "@/lib/uiStore";
import { buildRestoredPuzzleState } from "@/lib/puzzleRestore";

// ---------------------------------------------------------------------------
// Hoisted shared spies
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  renameMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  addMemberMutateAsync: vi.fn(),
  removeMemberMutateAsync: vi.fn(),
  deleteDatasetMutateAsync: vi.fn(),
  patchCollectionMeta: vi.fn(),
  getCollectionBackground: vi.fn(),
  postCollectionBackground: vi.fn(),
  deleteLayoutRevision: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  getQueryData: vi.fn(),
  refetchSaves: vi.fn(),
  refetchUserDatasets: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Hoisted proxy factory (same pattern as MySavesSection.test.tsx)
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
          return (...a: unknown[]) => `/api/mock/${(a as string[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// ---------------------------------------------------------------------------
// Mutable state read by vi.mock overrides
// ---------------------------------------------------------------------------
let currentIsSignedIn = true;
let currentCollections: unknown[] = [];
let currentSaves: unknown[] = [];
let currentUploads: unknown[] = [];

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useGetUserCollections: () => ({
        data: currentCollections,
        isFetching: false,
        isLoading: false,
        isPending: false,
        isError: false,
      }),
      useGetDatasetsMySaves: () => ({
        data: currentSaves,
        refetch: mocks.refetchSaves,
        isFetching: false,
        isLoading: false,
        isPending: false,
        isError: false,
      }),
      useGetUserDatasets: () => ({
        data: currentUploads,
        refetch: mocks.refetchUserDatasets,
        isFetching: false,
        isLoading: false,
        isPending: false,
        isError: false,
      }),
      usePostUserCollections: () => ({
        mutate: () => {},
        mutateAsync: mocks.createMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      usePatchUserCollectionsIdRename: () => ({
        mutate: () => {},
        mutateAsync: mocks.renameMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      useDeleteUserCollectionsId: () => ({
        mutate: () => {},
        mutateAsync: mocks.deleteMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      usePostUserCollectionsIdMembers: () => ({
        mutate: () => {},
        mutateAsync: mocks.addMemberMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      useDeleteUserCollectionsIdMembersMemberId: () => ({
        mutate: () => {},
        mutateAsync: mocks.removeMemberMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      // Regression sentinel: collections UI must never call dataset deletion.
      useDeleteUserDatasetsId: () => ({
        mutate: mocks.deleteDatasetMutateAsync,
        mutateAsync: mocks.deleteDatasetMutateAsync,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      patchUserCollectionsIdMeta: mocks.patchCollectionMeta,
      getUserCollectionsIdBackground: mocks.getCollectionBackground,
      postUserCollectionsIdBackground: mocks.postCollectionBackground,
      deleteUserCollectionsIdLayoutRevisionId: mocks.deleteLayoutRevision,
    }),
);

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({
    useAuth: () => ({ isSignedIn: currentIsSignedIn, isLoaded: true }),
  });
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
    getQueryData: mocks.getQueryData,
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COLLECTION_EMPTY = {
  id: "col-empty",
  name: "Empty Collection",
  members: [],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const COLLECTION_TRIP = {
  id: "col-trip",
  name: "August Trip",
  members: [
    { id: "mem-1", kind: "dataset", refId: "ds-1", name: "Lake Upload", createdAt: "2024-01-02T00:00:00Z" },
    { id: "mem-2", kind: "catalogSave", refId: "save-1", name: "NOAA Coastal DEM", createdAt: "2024-01-03T00:00:00Z" },
  ],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const REVISION_1 = {
  id: "rev-1",
  name: "Draft 1",
  savedAt: "2024-02-01T00:00:00Z",
  tiles: [
    { datasetId: "ds-1", tx: 12, ty: -8, angleDeg: 90, locked: true, annotation: "north shelf" },
    { datasetId: "ds-2", tx: -4, ty: 6, angleDeg: 0, locked: false, annotation: null },
  ],
  groups: [{ id: "g1", name: "Group 1", datasetIds: ["ds-1", "ds-2"] }],
};

const COLLECTION_SPECIAL = {
  id: "col-sp",
  name: "Alaska 01",
  collectionKind: "special",
  specialMeta: {
    bgImageKey: null,
    bgOpacity: 0.5,
    bgGeoAnchors: null,
    layoutRevisions: [REVISION_1],
    activeRevisionId: "rev-1",
  },
  members: [
    { id: "mem-sp-1", kind: "dataset", refId: "ds-1", name: "Survey A", createdAt: "2024-01-02T00:00:00Z" },
    { id: "mem-sp-2", kind: "dataset", refId: "ds-2", name: "Survey B", createdAt: "2024-01-03T00:00:00Z" },
  ],
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

function makeGrid(datasetId: string) {
  return {
    datasetId,
    minLat: 0, maxLat: 1, minLon: 0, maxLon: 1,
    minDepth: 0, maxDepth: 10,
    width: 2, height: 2, resolution: 2,
    depths: [0, 5, 5, 10],
  };
}

class FakeApiError extends Error {
  data: unknown;
  status: number;
  constructor(code: string, status = 400) {
    super(`HTTP ${status}: ${code}`);
    this.data = { error: code };
    this.status = status;
  }
}

beforeEach(() => {
  currentIsSignedIn = true;
  currentCollections = [];
  currentSaves = [];
  currentUploads = [];
  mocks.createMutateAsync.mockReset().mockResolvedValue({ id: "col-new", name: "New", members: [] });
  mocks.renameMutateAsync.mockReset().mockResolvedValue({});
  mocks.deleteMutateAsync.mockReset().mockResolvedValue(undefined);
  mocks.addMemberMutateAsync.mockReset().mockResolvedValue({ id: "mem-new" });
  mocks.removeMemberMutateAsync.mockReset().mockResolvedValue(undefined);
  mocks.deleteDatasetMutateAsync.mockReset();
  mocks.patchCollectionMeta.mockReset().mockImplementation(
    (_id: string, data: { bgGeoAnchors?: unknown }) =>
      Promise.resolve({
        ...COLLECTION_SPECIAL,
        specialMeta: { ...COLLECTION_SPECIAL.specialMeta, bgGeoAnchors: data.bgGeoAnchors ?? null },
      }),
  );
  mocks.getCollectionBackground.mockReset().mockResolvedValue(new Blob(["reference"], { type: "image/png" }));
  mocks.postCollectionBackground.mockReset().mockResolvedValue(undefined);
  mocks.deleteLayoutRevision.mockReset().mockResolvedValue(undefined);
  mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
  mocks.setQueryData.mockReset();
  mocks.getQueryData.mockReset().mockReturnValue(undefined);
  mocks.refetchSaves.mockReset().mockImplementation(async () => ({
    data: currentSaves,
    isError: false,
  }));
  mocks.refetchUserDatasets.mockReset().mockImplementation(async () => ({
    data: currentUploads,
    isError: false,
  }));
  act(() => useTerrainStore.getState().clear());
  useSpecialCollectionStore.setState({ active: null, pendingRestore: null, pendingPuzzleOn: 0, geoLayout: null, unresolvedMemberNames: [] });
  useUiStore.getState().setOverviewOpen(false);
  useUiStore.getState().setCollectionLoadNotice(null);
});

// ---------------------------------------------------------------------------
// CollectionsSection
// ---------------------------------------------------------------------------

describe("CollectionsSection", () => {
  it("renders nothing when signed out", () => {
    currentIsSignedIn = false;
    renderWithProviders(<CollectionsSection />);
    expect(screen.queryByTestId("collections-section")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no collections", () => {
    renderWithProviders(<CollectionsSection />);
    expect(screen.getByTestId("collections-empty")).toBeInTheDocument();
  });

  it("lists collections sorted by name with member counts", () => {
    currentCollections = [COLLECTION_EMPTY, COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    const rows = screen.getAllByTestId(/^collection-row-/);
    expect(rows).toHaveLength(2);
    // "August Trip" sorts before "Empty Collection"
    expect(rows[0]).toHaveAttribute("data-testid", "collection-row-col-trip");
    expect(screen.getByText(/August Trip/)).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("expanding a collection lists its members with names and kinds", () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-expand-collection-col-trip"));
    expect(screen.getByTestId("collection-member-mem-1")).toHaveTextContent("Lake Upload");
    expect(screen.getByTestId("collection-member-mem-2")).toHaveTextContent("NOAA Coastal DEM");
  });

  it("expanded empty collection shows its per-collection empty state", () => {
    currentCollections = [COLLECTION_EMPTY];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-expand-collection-col-empty"));
    expect(screen.getByTestId("collection-members-empty-col-empty")).toBeInTheDocument();
  });

  it("exposes a disabled Load action for empty collections", () => {
    currentCollections = [COLLECTION_EMPTY];
    renderWithProviders(<CollectionsSection />);
    const load = screen.getByTestId("btn-load-collection-col-empty");
    expect(load).toBeDisabled();
    expect(load).toHaveAttribute("aria-label", 'Load collection "Empty Collection" into 3D Explore');
    expect(load).toHaveAttribute("title", "This collection has no datasets to load");
  });

  it("loads standard collections with source-aware members and enters Explore", async () => {
    const activateCollection = vi.fn();
    const original = useTerrainStore.getState().activateCollection;
    useTerrainStore.setState({ activateCollection });
    currentCollections = [COLLECTION_TRIP];
    useUiStore.getState().setOverviewOpen(true);
    useUiStore.getState().setSidebarMode("plan");
    currentSaves = [{ id: "save-1", datasetId: "catalog-1" }];
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
      { datasetId: "catalog-1", source: "user" },
    ]));
    expect(useUiStore.getState().overviewOpen).toBe(false);
    expect(useUiStore.getState().sidebarMode).toBe("explore");
    expect(screen.getByTestId("btn-load-collection-col-trip")).toBeDisabled();
    expect(screen.getByTestId("btn-load-collection-col-trip")).toHaveTextContent("Loading…");
    useTerrainStore.setState({ activateCollection: original });
  });

  it("keeps available members loading and reports an unavailable catalog save", async () => {
    const activateCollection = vi.fn();
    const original = useTerrainStore.getState().activateCollection;
    useTerrainStore.setState({ activateCollection });
    currentCollections = [{
      ...COLLECTION_TRIP,
      members: [
        COLLECTION_TRIP.members[0],
        { id: "mem-missing", kind: "catalogSave", refId: "missing", name: "Not Ready", createdAt: "2024-01-03T00:00:00Z" },
      ],
    }];
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
    ]));
    expect(screen.getByTestId("collection-load-warning-col-trip")).toHaveTextContent(/Not Ready/);
    useTerrainStore.setState({ activateCollection: original });
  });

  it("offers only exact-name My Library candidates and waits for explicit confirmation before replacing a missing member", async () => {
    const original = useTerrainStore.getState().activateCollection;
    const activateCollection = vi.fn((entries: Parameters<typeof original>[0]) => {
      original(entries);
      const primary = entries[0];
      if (!primary) return;
      useTerrainStore.getState().setDatasetGrids(primary.datasetId, {
        activeGrid: makeGrid(primary.datasetId) as never,
        overviewGrid: makeGrid(primary.datasetId) as never,
      });
    });
    useTerrainStore.setState({ activateCollection });
    currentCollections = [{
      ...COLLECTION_TRIP,
      members: [
        COLLECTION_TRIP.members[0],
        { id: "mem-missing", kind: "catalogSave", refId: "missing-save", name: "Exact Match", createdAt: "2024-01-03T00:00:00Z" },
      ],
    }];
    currentUploads = [
      { id: "upload-one", name: "Exact Match" },
      { id: "upload-two", name: "Exact Match" },
      { id: "upload-substring", name: "Exact Match Extended" },
      { id: "upload-case", name: "exact match" },
    ];
    mocks.refetchSaves.mockResolvedValue({
      data: [
        { id: "missing-save", status: "failed", catalogId: "old-save" },
        { id: "ready-save", status: "ready", datasetId: "catalog-replacement", catalogId: "replacement", displayLabel: "Exact Match" },
      ],
      isError: false,
    });
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
    ]));
    expect(screen.getAllByTestId(/^collection-recovery-candidate-col-trip-/)).toHaveLength(3);
    expect(screen.getByTestId("collection-recovery-candidate-col-trip-uploaded:upload-one"))
      .toHaveTextContent("Uploaded dataset · upload-one · dataset upload-one");
    expect(screen.getByTestId("collection-recovery-candidate-col-trip-catalogSave:ready-save:catalog-replacement"))
      .toHaveTextContent("Ready catalog save · ready-save · dataset catalog-replacement");
    expect(screen.queryByText(/Exact Match Extended/)).not.toBeInTheDocument();
    expect(screen.queryByText(/exact match/)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId("btn-load-collection-col-trip")).toBeEnabled());
    fireEvent.click(screen.getByTestId("collection-recovery-candidate-col-trip-uploaded:upload-one"));
    expect(activateCollection).toHaveBeenCalledTimes(1);
    expect(mocks.addMemberMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("btn-apply-collection-recovery-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenLastCalledWith([
      { datasetId: "ds-1", source: "user" },
      { datasetId: "upload-one", source: "user" },
    ]));
    expect(mocks.addMemberMutateAsync).not.toHaveBeenCalled();
    useTerrainStore.setState({ activateCollection: original });
  });

  it("shows a retryable verification error without activating a partial collection when My Saves cannot be verified", async () => {
    const activateCollection = vi.fn();
    const original = useTerrainStore.getState().activateCollection;
    useTerrainStore.setState({ activateCollection });
    currentCollections = [COLLECTION_TRIP];
    mocks.refetchSaves.mockResolvedValue({ data: undefined, isError: true });
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => {
      expect(screen.getByTestId("collection-verification-error-col-trip"))
        .toHaveTextContent("Could not verify your saved datasets. Try again.");
    });
    expect(screen.getByTestId("btn-retry-collection-verification-col-trip")).toBeEnabled();
    expect(activateCollection).not.toHaveBeenCalled();
    expect(screen.queryByTestId("collection-load-warning-col-trip")).not.toBeInTheDocument();
    expect(useTerrainStore.getState().collectionScopeId).toBeNull();

    mocks.refetchSaves.mockResolvedValue({
      data: [
        { id: "save-1", status: "ready", datasetId: "catalog-1", catalogId: "catalog-1" },
      ],
      isError: false,
    });
    fireEvent.click(screen.getByTestId("btn-retry-collection-verification-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
      { datasetId: "catalog-1", source: "user" },
    ]));
    useTerrainStore.setState({ activateCollection: original });
  });

  it("does not misreport confirmed missing members when My Library recovery lookup fails", async () => {
    const activateCollection = vi.fn();
    const original = useTerrainStore.getState().activateCollection;
    useTerrainStore.setState({ activateCollection });
    currentCollections = [{
      ...COLLECTION_TRIP,
      members: [
        COLLECTION_TRIP.members[0],
        { id: "mem-missing", kind: "catalogSave", refId: "missing-save", name: "Needs Lookup", createdAt: "2024-01-03T00:00:00Z" },
      ],
    }];
    mocks.refetchSaves.mockResolvedValue({
      data: [{ id: "missing-save", status: "failed", catalogId: "old-save" }],
      isError: false,
    });
    mocks.refetchUserDatasets.mockResolvedValue({ data: undefined, isError: true });
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => {
      expect(screen.getByTestId("collection-verification-error-col-trip"))
        .toHaveTextContent("Could not verify My Library for recovery matches. Try again.");
    });
    expect(activateCollection).not.toHaveBeenCalled();
    expect(screen.queryByTestId("collection-load-warning-col-trip")).not.toBeInTheDocument();

    mocks.refetchUserDatasets.mockResolvedValue({
      data: [{ id: "recovery-upload", name: "Needs Lookup" }],
      isError: false,
    });
    fireEvent.click(screen.getByTestId("btn-retry-collection-verification-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
    ]));
    expect(screen.getByTestId("collection-recovery-candidate-col-trip-uploaded:recovery-upload"))
      .toHaveTextContent("Needs Lookup");
    useTerrainStore.setState({ activateCollection: original });
  });

  it("shows a retryable row error when the primary collection dataset fails to load", async () => {
    const activateCollection = vi.fn();
    const original = useTerrainStore.getState().activateCollection;
    useTerrainStore.setState({ activateCollection });
    currentCollections = [COLLECTION_TRIP];
    currentSaves = [{ id: "save-1", datasetId: "catalog-1" }];
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalled());
    act(() => useTerrainStore.setState({ datasetFetchErrorIds: ["ds-1"] }));

    await waitFor(() => {
      expect(screen.getByTestId("collection-load-error-col-trip"))
        .toHaveTextContent("Could not load the primary dataset into 3D Explore");
    });
    expect(screen.getByTestId("btn-load-collection-col-trip")).toBeEnabled();
    useTerrainStore.setState({ activateCollection: original });
  });

  it("retries unavailable catalog saves additively without entering Puzzle mode", async () => {
    const addCollectionMembers = vi.fn();
    const originalActivate = useTerrainStore.getState().activateCollection;
    const originalAdd = useTerrainStore.getState().addCollectionMembers;
    const activateCollection = vi.fn((entries: Parameters<typeof originalActivate>[0]) => {
      originalActivate(entries);
      const primary = entries[0];
      if (!primary) return;
      useTerrainStore.getState().setDatasetGrids(primary.datasetId, {
        activeGrid: makeGrid(primary.datasetId) as never,
        overviewGrid: makeGrid(primary.datasetId) as never,
      });
    });
    useTerrainStore.setState({ activateCollection, addCollectionMembers });
    const incompleteCollection = {
      ...COLLECTION_TRIP,
      members: [
        COLLECTION_TRIP.members[0],
        { id: "mem-later", kind: "catalogSave", refId: "save-later", name: "Ready Later", createdAt: "2024-01-03T00:00:00Z" },
      ],
    };
    currentCollections = [incompleteCollection];
    currentSaves = [];
    renderWithProviders(<CollectionsSection />);

    fireEvent.click(screen.getByTestId("btn-load-collection-col-trip"));
    await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
    ]));
    await waitFor(() => expect(screen.getByTestId("btn-retry-collection-col-trip")).toBeEnabled());

    const freshSave = { id: "save-later", datasetId: "catalog-later" };
    mocks.refetchSaves.mockResolvedValueOnce({ data: [freshSave], isError: false });
    fireEvent.click(screen.getByTestId("btn-retry-collection-col-trip"));
    await waitFor(() => expect(addCollectionMembers).toHaveBeenCalledWith([
      { datasetId: "ds-1", source: "user" },
      { datasetId: "catalog-later", source: "user" },
    ]));
    expect(useUiStore.getState().overviewOpen).toBe(false);
    expect(screen.queryByTestId("collection-load-warning-col-trip")).not.toBeInTheDocument();

    useTerrainStore.setState({ activateCollection: originalActivate, addCollectionMembers: originalAdd });
  });

  it("creates a collection via + new and invalidates the query", async () => {
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-new-collection"));
    fireEvent.change(screen.getByTestId("input-new-collection"), { target: { value: "  Trip Prep " } });
    fireEvent.click(screen.getByTestId("btn-create-collection"));
    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({ data: { name: "Trip Prep" } });
    });
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("shows a friendly error when the name is a duplicate", async () => {
    mocks.createMutateAsync.mockRejectedValue(new FakeApiError("duplicate_name"));
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-new-collection"));
    fireEvent.change(screen.getByTestId("input-new-collection"), { target: { value: "Dupe" } });
    fireEvent.click(screen.getByTestId("btn-create-collection"));
    await waitFor(() => {
      expect(screen.getByTestId("collections-create-error")).toHaveTextContent(/already exists/i);
    });
    // Input stays open so the user can correct the name.
    expect(screen.getByTestId("input-new-collection")).toBeInTheDocument();
  });

  it("renames a collection inline", async () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-rename-collection-col-trip"));
    const input = screen.getByTestId("input-rename-collection");
    fireEvent.change(input, { target: { value: "September Trip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(mocks.renameMutateAsync).toHaveBeenCalledWith({ id: "col-trip", data: { name: "September Trip" } });
    });
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("shows a friendly error when renaming to a duplicate name", async () => {
    mocks.renameMutateAsync.mockRejectedValue(new FakeApiError("duplicate_name"));
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-rename-collection-col-trip"));
    const input = screen.getByTestId("input-rename-collection");
    fireEvent.change(input, { target: { value: "Taken" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(screen.getByTestId("collection-rename-error")).toHaveTextContent(/already exists/i);
    });
  });

  it("deletes a collection after confirm; copy says datasets stay", async () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-delete-collection-col-trip"));
    expect(screen.getByText(/stay in your library/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-confirm-delete-collection"));
    await waitFor(() => {
      expect(mocks.deleteMutateAsync).toHaveBeenCalledWith({ id: "col-trip" });
    });
    // Regression guard: deleting a collection never touches dataset deletion.
    expect(mocks.deleteDatasetMutateAsync).not.toHaveBeenCalled();
  });

  it("cancel in the delete dialog does not delete", () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-delete-collection-col-trip"));
    fireEvent.click(screen.getByTestId("btn-cancel-delete-collection"));
    expect(mocks.deleteMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("btn-confirm-delete-collection")).not.toBeInTheDocument();
  });

  it("removes a member without deleting the dataset", async () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-expand-collection-col-trip"));
    fireEvent.click(screen.getByTestId("btn-remove-member-mem-1"));
    await waitFor(() => {
      expect(mocks.removeMemberMutateAsync).toHaveBeenCalledWith({ id: "col-trip", memberId: "mem-1" });
    });
    expect(mocks.deleteDatasetMutateAsync).not.toHaveBeenCalled();
  });

  it("keeps a member visible with a retryable error when removal fails", async () => {
    currentCollections = [COLLECTION_TRIP];
    mocks.removeMemberMutateAsync.mockRejectedValueOnce(new Error("Network unavailable"));
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-expand-collection-col-trip"));
    fireEvent.click(screen.getByTestId("btn-remove-member-mem-1"));

    await waitFor(() => {
      expect(screen.getByTestId("collection-member-remove-error-mem-1")).toHaveTextContent(/network unavailable/i);
    });
    expect(screen.getByTestId("collection-member-mem-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("btn-retry-remove-member-mem-1"));
    await waitFor(() => expect(mocks.removeMemberMutateAsync).toHaveBeenCalledTimes(2));
  });

  it("closes collection deletion with Escape and returns focus to its trigger", async () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    const trigger = screen.getByTestId("btn-delete-collection-col-trip");
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: /delete collection/i }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("btn-confirm-delete-collection")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Special collections (reference-image puzzle assembly)
// ---------------------------------------------------------------------------

describe("CollectionsSection — special collections", () => {
  it("standard collections show no settings gear or activate button", () => {
    currentCollections = [COLLECTION_TRIP];
    renderWithProviders(<CollectionsSection />);
    expect(screen.queryByTestId("btn-collection-settings-col-trip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-activate-collection-col-trip")).not.toBeInTheDocument();
  });

  it("special create flow posts collectionKind and opens the settings sheet", async () => {
    mocks.createMutateAsync.mockResolvedValue({
      id: "col-sp-new",
      name: "Alaska 01",
      collectionKind: "special",
      specialMeta: {
        bgImageKey: null,
        bgOpacity: 0.5,
        bgGeoAnchors: null,
        layoutRevisions: [],
        activeRevisionId: null,
      },
      members: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-new-collection"));
    fireEvent.click(screen.getByTestId("input-new-collection-special"));
    fireEvent.change(screen.getByTestId("input-new-collection"), { target: { value: "Alaska 01" } });
    fireEvent.click(screen.getByTestId("btn-create-collection"));
    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        data: { name: "Alaska 01", collectionKind: "special" },
      });
    });
    // Settings sheet opens immediately on the freshly created collection.
    await waitFor(() => {
      expect(screen.getByTestId("collection-settings-sheet-col-sp-new")).toBeInTheDocument();
    });
  });

  it("settings sheet closes with Escape and restores focus to its gear trigger", async () => {
    currentCollections = [COLLECTION_SPECIAL];
    renderWithProviders(<CollectionsSection />);
    const trigger = screen.getByTestId("btn-collection-settings-col-sp");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("collection-settings-sheet-col-sp")).toBeInTheDocument();
    // The saved revision is listed with Restore/Delete actions.
    expect(screen.getByTestId("collection-revision-row-rev-1")).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("collection-settings-sheet-col-sp")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("rejects unsupported and oversized reference images before uploading", async () => {
    currentCollections = [COLLECTION_SPECIAL];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    const input = screen.getByTestId("input-collection-bg-file-col-sp");

    fireEvent.change(input, {
      target: { files: [new File(["gif"], "reference.gif", { type: "image/gif" })] },
    });
    expect(screen.getByTestId("collection-settings-error")).toHaveTextContent(/jpeg, png, or webp/i);
    expect(mocks.postCollectionBackground).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] },
    });
    expect(screen.getByTestId("collection-settings-error")).toHaveTextContent(/10 mb or smaller/i);
    expect(mocks.postCollectionBackground).not.toHaveBeenCalled();
  });

  it("distinguishes an unavailable configured reference image from no image", async () => {
    currentCollections = [{
      ...COLLECTION_SPECIAL,
      specialMeta: { ...COLLECTION_SPECIAL.specialMeta, bgImageKey: "collection-bg/missing.png" },
    }];
    mocks.getCollectionBackground.mockRejectedValueOnce(new Error("Not found"));
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    expect(await screen.findByTestId("collection-bg-load-error-col-sp")).toHaveTextContent(/configured reference image/i);
  });

  it("flushes the latest opacity choice on close and makes unsaved changes retryable", async () => {
    currentCollections = [COLLECTION_SPECIAL];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    fireEvent.change(screen.getByTestId("input-collection-bg-opacity-col-sp"), { target: { value: "42" } });
    fireEvent.change(screen.getByTestId("input-collection-bg-opacity-col-sp"), { target: { value: "63" } });
    fireEvent.click(screen.getByTestId("btn-close-collection-settings-col-sp"));

    await waitFor(() => {
      expect(mocks.patchCollectionMeta).toHaveBeenCalledWith("col-sp", { bgOpacity: 0.63 });
    });

    // Open a new sheet instance to exercise an explicit retry after a failed save.
    mocks.patchCollectionMeta.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    fireEvent.change(screen.getByTestId("input-collection-bg-opacity-col-sp"), { target: { value: "44" } });
    fireEvent.click(screen.getByTestId("btn-close-collection-settings-col-sp"));
    // A failed close keeps the sheet open and exposes an explicit retry rather
    // than pretending the local slider was durable.
    await waitFor(() => expect(mocks.patchCollectionMeta).toHaveBeenCalledWith("col-sp", { bgOpacity: 0.44 }));
    expect(screen.getByTestId("collection-settings-sheet-col-sp")).toBeInTheDocument();
    expect(screen.getByTestId("collection-opacity-save-status-col-sp")).toHaveTextContent(/not saved yet/i);
    fireEvent.click(screen.getByTestId("btn-retry-collection-bg-opacity-col-sp"));
    await waitFor(() => expect(mocks.patchCollectionMeta).toHaveBeenLastCalledWith("col-sp", { bgOpacity: 0.44 }));
  });

  it("does not claim a restored revision is server-active until persistence succeeds", async () => {
    const revision2 = { ...REVISION_1, id: "rev-2", name: "Draft 2", savedAt: "2024-03-01T00:00:00Z" };
    const collection = {
      ...COLLECTION_SPECIAL,
      specialMeta: { ...COLLECTION_SPECIAL.specialMeta, layoutRevisions: [REVISION_1, revision2] },
    };
    currentCollections = [collection];
    useSpecialCollectionStore.setState({
      active: {
        collectionId: "col-sp",
        name: "Alaska 01",
        bgImage: null,
        bgImageW: 0,
        bgImageH: 0,
        bgOpacity: 0.5,
        bgGeoAnchors: null,
        layoutRevisions: [REVISION_1, revision2],
        activeRevisionId: "rev-1",
      },
    });
    mocks.patchCollectionMeta.mockRejectedValueOnce(new Error("Offline"));
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    fireEvent.click(screen.getByTestId("btn-restore-revision-rev-2"));

    await waitFor(() => {
      expect(screen.getByTestId("collection-settings-error")).toHaveTextContent(/could not save the active layout/i);
    });
    expect(screen.getByTestId("collection-revision-row-rev-1")).toHaveTextContent(/active/i);
    expect(screen.getByTestId("collection-revision-row-rev-2")).not.toHaveTextContent(/active/i);
  });

  it("confirms revision deletion, prevents duplicate submission, and retains it after failure", async () => {
    currentCollections = [COLLECTION_SPECIAL];
    let rejectDelete!: (reason?: unknown) => void;
    mocks.deleteLayoutRevision.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { rejectDelete = reject; }),
    );
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    fireEvent.click(screen.getByTestId("btn-delete-revision-rev-1"));
    expect(screen.getByTestId("confirm-delete-revision-dialog-rev-1")).toBeInTheDocument();
    const confirm = screen.getByTestId("btn-confirm-delete-revision-rev-1");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.deleteLayoutRevision).toHaveBeenCalledTimes(1);

    rejectDelete(new Error("Offline"));
    await waitFor(() => {
      expect(screen.getByTestId("collection-revision-delete-error-rev-1")).toHaveTextContent(/still saved/i);
    });
    expect(screen.getByTestId("collection-revision-row-rev-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("btn-confirm-delete-revision-rev-1"));
    await waitFor(() => expect(mocks.deleteLayoutRevision).toHaveBeenCalledTimes(2));
  });

  it("pins, validates, retries, and synchronizes two GPS anchors", async () => {
    const withReferenceImage = {
      ...COLLECTION_SPECIAL,
      specialMeta: { ...COLLECTION_SPECIAL.specialMeta, bgImageKey: "collection-bg/col-sp.png" },
    };
    currentCollections = [withReferenceImage];
    useSpecialCollectionStore.setState({
      active: {
        collectionId: "col-sp",
        name: "Alaska 01",
        bgImage: null,
        bgImageW: 0,
        bgImageH: 0,
        bgOpacity: 0.5,
        bgGeoAnchors: null,
        layoutRevisions: [REVISION_1],
        activeRevisionId: "rev-1",
      },
    });
    mocks.patchCollectionMeta
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockImplementation((_id: string, data: { bgGeoAnchors?: unknown }) =>
        Promise.resolve({
          ...withReferenceImage,
          specialMeta: { ...withReferenceImage.specialMeta, bgGeoAnchors: data.bgGeoAnchors ?? null },
        }),
      );
    const createObjectUrl = vi.fn(() => "blob:reference-image");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });

    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    const preview = await screen.findByTestId("collection-bg-preview-col-sp");
    Object.defineProperties(preview, {
      naturalWidth: { configurable: true, value: 100 },
      naturalHeight: { configurable: true, value: 100 },
    });
    const previewTarget = preview.parentElement!;
    vi.spyOn(previewTarget, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.load(preview);

    expect(screen.getByTestId("anchor-pair-status-col-sp")).toHaveTextContent(/complete both/i);
    expect(screen.getByTestId("anchor-status-a-col-sp")).toHaveTextContent(/image point missing/i);
    expect(screen.getByTestId("input-anchor-a-lon-col-sp")).toHaveAttribute("min", "-180");
    expect(screen.getByTestId("input-anchor-a-lat-col-sp")).toHaveAttribute("max", "90");

    fireEvent.click(screen.getByTestId("btn-pin-anchor-a-col-sp"));
    fireEvent.click(preview, { clientX: 10, clientY: 20 });
    fireEvent.click(screen.getByTestId("btn-pin-anchor-b-col-sp"));
    fireEvent.click(preview, { clientX: 80, clientY: 70 });
    fireEvent.change(screen.getByTestId("input-anchor-a-lon-col-sp"), { target: { value: "-150.25" } });
    fireEvent.change(screen.getByTestId("input-anchor-a-lat-col-sp"), { target: { value: "61.5" } });
    fireEvent.change(screen.getByTestId("input-anchor-b-lon-col-sp"), { target: { value: "-149.75" } });
    fireEvent.change(screen.getByTestId("input-anchor-b-lat-col-sp"), { target: { value: "61.1" } });

    const save = screen.getByTestId("btn-save-anchors-col-sp");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => {
      expect(screen.getByTestId("collection-settings-error")).toHaveTextContent(/points are still here.*retry/i);
    });
    expect(screen.getByTestId("input-anchor-b-lat-col-sp")).toHaveValue(61.1);

    fireEvent.click(save);
    const expectedAnchors = [
      { lon: -150.25, lat: 61.5, imgX: 10, imgY: 20 },
      { lon: -149.75, lat: 61.1, imgX: 80, imgY: 70 },
    ];
    await waitFor(() => {
      expect(mocks.patchCollectionMeta).toHaveBeenLastCalledWith("col-sp", { bgGeoAnchors: expectedAnchors });
    });
    expect(screen.getByTestId("anchor-save-status-col-sp")).toHaveTextContent(/live reference image/i);
    expect(useSpecialCollectionStore.getState().active?.bgGeoAnchors).toEqual(expectedAnchors);
  });

  describe("Activate for Puzzle", () => {
    const origActivateCollection = useTerrainStore.getState().activateCollection;
    afterEach(() => {
      useTerrainStore.setState({ activateCollection: origActivateCollection });
    });

    it("loads members, opens the Overview, and queues the active revision restore", async () => {
      const activateCollection = vi.fn();
      useTerrainStore.setState({ activateCollection });
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp"));

      await waitFor(() => {
        expect(useSpecialCollectionStore.getState().pendingRestore).not.toBeNull();
      });
      // (a) every member dataset was loaded,
      expect(activateCollection).toHaveBeenCalledWith([
        { datasetId: "ds-1", source: "user" },
        { datasetId: "ds-2", source: "user" },
      ]);
      // (b/d) the collection is active (background overlay source of truth),
      const { active } = useSpecialCollectionStore.getState();
      expect(active?.collectionId).toBe("col-sp");
      expect(active?.bgOpacity).toBe(0.5);
      // and the Overview panel was opened.
      expect(useUiStore.getState().overviewOpen).toBe(true);
    });

    it("REGRESSION GUARD: the queued restore yields both tiles with store and canvas views in lockstep", async () => {
      useTerrainStore.setState({ activateCollection: vi.fn() });
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp"));

      await waitFor(() => {
        expect(useSpecialCollectionStore.getState().pendingRestore).not.toBeNull();
      });
      const payload = useSpecialCollectionStore.getState().pendingRestore!.payload;
      expect(payload.tiles).toHaveLength(2);

      // Build the restored state exactly as OverviewMap's consumer effect does.
      const restored = buildRestoredPuzzleState(payload, new Set(["ds-1", "ds-2"]), 0);

      // Both tiles present in BOTH views simultaneously…
      for (const id of ["ds-1", "ds-2"] as const) {
        expect(restored.transforms.has(id)).toBe(true);
        expect(id in restored.storeRecord).toBe(true);
        // …and the two views can never diverge: same object identity.
        expect(restored.storeRecord[id]).toBe(restored.transforms.get(id));
      }
      // Values match the fetched revision (a partial apply would break one side).
      expect(restored.transforms.get("ds-1")).toMatchObject({
        tx: 12, ty: -8, angleDeg: 90, locked: true, annotation: "north shelf",
      });
      expect(restored.transforms.get("ds-2")).toMatchObject({ tx: -4, ty: 6, angleDeg: 0 });
      // The group round-trips too.
      expect(restored.groups.size).toBe(1);
      expect([...[...restored.groups.values()][0]!].sort()).toEqual(["ds-1", "ds-2"]);
    });

    it("loads oversized mixed collections with source-specific endpoints and skips unresolved saves", async () => {
      const activateCollection = vi.fn();
      useTerrainStore.setState({ activateCollection });
      currentCollections = [{
        ...COLLECTION_SPECIAL,
        members: [
          { id: "mem-upload", kind: "dataset", refId: "upload-1", name: "Upload", createdAt: "2024-01-01T00:00:00Z" },
          { id: "mem-save", kind: "catalogSave", refId: "save-materialized", name: "Catalog", createdAt: "2024-01-01T00:00:00Z" },
          { id: "mem-missing", kind: "catalogSave", refId: "save-missing", name: "Missing", createdAt: "2024-01-01T00:00:00Z" },
          { id: "mem-four", kind: "dataset", refId: "upload-2", name: "Upload 2", createdAt: "2024-01-01T00:00:00Z" },
        ],
      }];
      currentSaves = [{ id: "save-materialized", datasetId: "catalog-1" }];
      renderWithProviders(<CollectionsSection />);
      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp"));

      await waitFor(() => expect(activateCollection).toHaveBeenCalled());
      expect(activateCollection).toHaveBeenCalledWith([
        { datasetId: "upload-1", source: "user" },
        { datasetId: "catalog-1", source: "user" },
        { datasetId: "upload-2", source: "user" },
      ]);
      expect(screen.getByTestId("collection-load-warning-col-sp")).toHaveTextContent(
        "Unavailable puzzle piece: Missing",
      );
      expect(useSpecialCollectionStore.getState().unresolvedMemberNames).toEqual(["Missing"]);
    });

    it("refreshes stale My Saves before activating a special collection, avoiding a false unavailable-piece warning", async () => {
      const activateCollection = vi.fn();
      useTerrainStore.setState({ activateCollection });
      currentCollections = [{
        ...COLLECTION_SPECIAL,
        members: [
          { id: "mem-upload", kind: "dataset", refId: "ds-1", name: "Survey A", createdAt: "2024-01-02T00:00:00Z" },
          { id: "mem-save", kind: "catalogSave", refId: "save-fresh", name: "Fresh Catalog", createdAt: "2024-01-03T00:00:00Z" },
        ],
      }];
      currentSaves = []; // Render-time cache is stale/empty.
      mocks.refetchSaves.mockResolvedValue({
        data: [{ id: "save-fresh", status: "ready", datasetId: "catalog-fresh", catalogId: "fresh" }],
        isError: false,
      });
      renderWithProviders(<CollectionsSection />);

      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp"));
      await waitFor(() => expect(activateCollection).toHaveBeenCalledWith([
        { datasetId: "ds-1", source: "user" },
        { datasetId: "catalog-fresh", source: "user" },
      ]));
      expect(mocks.refetchSaves).toHaveBeenCalled();
      expect(screen.queryByTestId("collection-load-warning-col-sp")).not.toBeInTheDocument();
      expect(useSpecialCollectionStore.getState().unresolvedMemberNames).toEqual([]);
    });

    it("clears the unavailable-member notice on the next complete activation", async () => {
      const activateCollection = vi.fn();
      useTerrainStore.setState({ activateCollection });
      const incompleteCollection = {
        ...COLLECTION_SPECIAL,
        id: "col-sp-incomplete",
        members: [
          { id: "mem-upload", kind: "dataset", refId: "upload-1", name: "Upload", createdAt: "2024-01-01T00:00:00Z" },
          { id: "mem-missing", kind: "catalogSave", refId: "save-missing", name: "Missing", createdAt: "2024-01-01T00:00:00Z" },
        ],
      };
      currentCollections = [incompleteCollection, COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp-incomplete"));
      await waitFor(() => expect(screen.getByTestId("collection-load-warning-col-sp-incomplete")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("btn-activate-collection-col-sp"));
      await waitFor(() => expect(screen.queryByTestId("collection-load-warning-col-sp-incomplete")).not.toBeInTheDocument());
    });
  });

  describe("Apply-to-3D badge", () => {
    afterEach(() => {
      useTerrainStore.getState().clear();
    });

    it("shows the teal '3D Applied' chip when the scene reflects this collection's layout", () => {
      useTerrainStore.setState({ primaryDatasetIds: ["ds-1", "ds-2"] });
      useSpecialCollectionStore.setState({
        geoLayout: { collectionId: "col-sp", datasetIds: ["ds-1", "ds-2"], status: "applied" },
      });
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      const badge = screen.getByTestId("geo-layout-badge-col-sp");
      expect(badge).toHaveTextContent("3D Applied");
    });

    it("shows the amber '3D Outdated' chip with the re-apply tooltip after layout edits", () => {
      useTerrainStore.setState({ primaryDatasetIds: ["ds-1", "ds-2"] });
      useSpecialCollectionStore.setState({
        geoLayout: { collectionId: "col-sp", datasetIds: ["ds-1", "ds-2"], status: "outdated" },
      });
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      const badge = screen.getByTestId("geo-layout-badge-col-sp");
      expect(badge).toHaveTextContent("3D Outdated");
      expect(badge).toHaveAttribute("title", "Re-apply the layout to sync the 3D scene.");
    });

    it("renders no badge when no layout has been applied", () => {
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      expect(screen.queryByTestId("geo-layout-badge-col-sp")).not.toBeInTheDocument();
    });

    it("clears the badge once the corrected datasets leave the 3D scene", async () => {
      useTerrainStore.setState({ primaryDatasetIds: ["ds-1"] }); // ds-2 no longer visible
      useSpecialCollectionStore.setState({
        geoLayout: { collectionId: "col-sp", datasetIds: ["ds-1", "ds-2"], status: "applied" },
      });
      currentCollections = [COLLECTION_SPECIAL];
      renderWithProviders(<CollectionsSection />);
      await waitFor(() => {
        expect(useSpecialCollectionStore.getState().geoLayout).toBeNull();
      });
      expect(screen.queryByTestId("geo-layout-badge-col-sp")).not.toBeInTheDocument();
    });

    it("markGeoLayoutOutdated flips applied→outdated only; empty applies are no-ops", () => {
      const st = useSpecialCollectionStore.getState();
      st.markGeoLayoutOutdated(); // nothing applied — no-op
      expect(useSpecialCollectionStore.getState().geoLayout).toBeNull();
      st.markGeoLayoutApplied("col-sp", []); // empty dataset list — no-op
      expect(useSpecialCollectionStore.getState().geoLayout).toBeNull();
      st.markGeoLayoutApplied("col-sp", ["ds-1"]);
      expect(useSpecialCollectionStore.getState().geoLayout?.status).toBe("applied");
      st.markGeoLayoutOutdated();
      expect(useSpecialCollectionStore.getState().geoLayout?.status).toBe("outdated");
      st.clearGeoLayout();
      expect(useSpecialCollectionStore.getState().geoLayout).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// AddToCollectionDialog
// ---------------------------------------------------------------------------

describe("AddToCollectionDialog", () => {
  it("closes with Escape and restores focus to its opener", async () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = renderWithProviders(
      <AddToCollectionDialog label="Lake Upload" targets={[{ datasetId: "ds-1" }]} onClose={onClose} />,
    );

    expect(document.activeElement).toBe(screen.getByTestId("add-to-collection-dialog"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("adds all targets to the picked collection (multi-select bulk add)", async () => {
    currentCollections = [COLLECTION_TRIP, COLLECTION_EMPTY];
    const onClose = vi.fn();
    renderWithProviders(
      <AddToCollectionDialog
        label="2 datasets"
        targets={[{ datasetId: "ds-1" }, { datasetId: "ds-2" }]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("add-to-collection-option-col-trip"));
    fireEvent.click(screen.getByTestId("btn-confirm-add-to-collection"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.addMemberMutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.addMemberMutateAsync).toHaveBeenCalledWith({ id: "col-trip", data: { datasetId: "ds-1" } });
    expect(mocks.addMemberMutateAsync).toHaveBeenCalledWith({ id: "col-trip", data: { datasetId: "ds-2" } });
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("supports catalog-save targets", async () => {
    currentCollections = [COLLECTION_TRIP];
    const onClose = vi.fn();
    renderWithProviders(
      <AddToCollectionDialog label="My Bay Save" targets={[{ catalogSaveId: "save-9" }]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("add-to-collection-option-col-trip"));
    fireEvent.click(screen.getByTestId("btn-confirm-add-to-collection"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.addMemberMutateAsync).toHaveBeenCalledWith({ id: "col-trip", data: { catalogSaveId: "save-9" } });
  });

  it("creates a new collection first when a new name is typed", async () => {
    currentCollections = [];
    mocks.createMutateAsync.mockResolvedValue({ id: "col-created", name: "Fresh", members: [] });
    const onClose = vi.fn();
    renderWithProviders(
      <AddToCollectionDialog label="Lake Upload" targets={[{ datasetId: "ds-1" }]} onClose={onClose} />,
    );
    fireEvent.change(screen.getByTestId("input-new-collection-name"), { target: { value: "Fresh" } });
    fireEvent.click(screen.getByTestId("btn-confirm-add-to-collection"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.createMutateAsync).toHaveBeenCalledWith({ data: { name: "Fresh" } });
    expect(mocks.addMemberMutateAsync).toHaveBeenCalledWith({ id: "col-created", data: { datasetId: "ds-1" } });
  });

  it("shows an error and stays open when adding fails", async () => {
    currentCollections = [COLLECTION_TRIP];
    mocks.addMemberMutateAsync.mockRejectedValue(new FakeApiError("not_found", 404));
    const onClose = vi.fn();
    renderWithProviders(
      <AddToCollectionDialog label="Lake Upload" targets={[{ datasetId: "ds-1" }]} onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("add-to-collection-option-col-trip"));
    fireEvent.click(screen.getByTestId("btn-confirm-add-to-collection"));
    await waitFor(() => {
      expect(screen.getByTestId("add-to-collection-error")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
