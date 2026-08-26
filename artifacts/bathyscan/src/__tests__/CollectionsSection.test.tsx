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
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  getQueryData: vi.fn(),
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
  mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
  mocks.setQueryData.mockReset();
  mocks.getQueryData.mockReset().mockReturnValue(undefined);
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
    expect(screen.getByTestId("btn-retry-collection-col-trip")).toBeInTheDocument();

    const freshSave = { id: "save-later", datasetId: "catalog-later" };
    mocks.getQueryData.mockReturnValue([freshSave]);
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

  it("settings sheet opens from the gear button and closes again", async () => {
    currentCollections = [COLLECTION_SPECIAL];
    renderWithProviders(<CollectionsSection />);
    fireEvent.click(screen.getByTestId("btn-collection-settings-col-sp"));
    expect(screen.getByTestId("collection-settings-sheet-col-sp")).toBeInTheDocument();
    // The saved revision is listed with Restore/Delete actions.
    expect(screen.getByTestId("collection-revision-row-rev-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-close-collection-settings-col-sp"));
    await waitFor(() => {
      expect(screen.queryByTestId("collection-settings-sheet-col-sp")).not.toBeInTheDocument();
    });
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
