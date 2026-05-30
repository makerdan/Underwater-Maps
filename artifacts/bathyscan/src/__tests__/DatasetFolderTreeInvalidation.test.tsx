/**
 * Invalidation-contract tests for DatasetFolderTree.
 *
 * Verifies that deleting a user dataset (single row or recursively via folder
 * delete) both invalidates the list queries *and* evicts the per-dataset
 * terrain/overview cache entries, and notifies the parent of the removed
 * ids so it can clear active-dataset state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { DatasetFolderTree } from "@/components/DatasetFolderTree";

// Deletes use a 5s undo window before the actual mutation fires; fake
// timers let these tests advance past it deterministically.
const UNDO_WINDOW_MS = 5000;

// ─── Mutation captures ───────────────────────────────────────────────────────
const deleteDatasetMutate = vi.fn();
const deleteFolderMutate = vi.fn();

// ─── React Query capture ────────────────────────────────────────────────────
const invalidateQueries = vi.fn();
const removeQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries, removeQueries }),
  };
});

vi.mock("@/lib/settingsStore", () => {
  const state = { datasetFolderExpanded: { f1: true } };
  const useSettingsStore = ((sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    setState: (updater: (s: typeof state) => Partial<typeof state>) => void;
    getState: () => typeof state;
  };
  useSettingsStore.setState = (updater) => Object.assign(state, updater(state));
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

vi.mock("@/lib/terrainStore", () => {
  const state = {
    visibleDatasets: [] as Array<{ datasetId: string }>,
    primaryDatasetId: null as string | null,
    toggleVisible: vi.fn(),
  };
  const useTerrainStore = ((sel?: (s: typeof state) => unknown) =>
    sel ? sel(state) : state) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown;
    getState: () => typeof state;
  };
  useTerrainStore.getState = () => state;
  return { useTerrainStore };
});

vi.mock("@/lib/contextMenuStore", () => ({
  useContextMenuStore: { getState: () => ({ show: vi.fn() }) },
}));

vi.mock("@/components/LoadingDial", () => ({
  LoadingDial: () => null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetUserFolders: () => ({
    data: [
      { id: "f1", name: "Reservoirs", parentId: null },
    ],
  }),
  usePostUserFolders: () => ({ mutate: vi.fn() }),
  usePatchUserFoldersIdRename: () => ({ mutate: vi.fn() }),
  usePatchUserFoldersIdMove: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  usePostUserFoldersIdDuplicate: () => ({ mutate: vi.fn() }),
  useDeleteUserFoldersId: () => ({
    mutate: deleteFolderMutate,
    isPending: false,
    variables: undefined,
  }),
  useDeleteUserDatasetsId: () => ({
    mutate: deleteDatasetMutate,
    isPending: false,
    variables: undefined,
  }),
  usePatchUserDatasetsIdMove: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  usePatchUserDatasetsIdRename: () => ({ mutate: vi.fn() }),
  usePostUserDatasetsIdDuplicate: () => ({ mutate: vi.fn() }),
  getGetUserFoldersQueryKey: () => ["user-folders"],
  getGetUserDatasetsQueryKey: () => ["user-datasets"],
  getGetUserDatasetsIdTerrainQueryKey: (id: string) => ["user-datasets", id, "terrain"],
  getGetUserDatasetsIdOverviewQueryKey: (id: string) => ["user-datasets", id, "overview"],
}));

const datasets = [
  { id: "d1", name: "Cove A", folderId: "f1", minDepth: 0, maxDepth: 10, updatedAt: "2025-01-01" },
  { id: "d2", name: "Cove B", folderId: "f1", minDepth: 0, maxDepth: 15, updatedAt: "2025-01-02" },
  { id: "d3", name: "Loose dataset", folderId: null, minDepth: 0, maxDepth: 5, updatedAt: "2025-01-03" },
];

describe("DatasetFolderTree — undo-window flush on unmount", () => {
  beforeEach(() => {
    deleteDatasetMutate.mockReset();
    invalidateQueries.mockReset();
    removeQueries.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits pending dataset delete immediately when the component unmounts mid-window", () => {
    const onDatasetsRemoved = vi.fn();
    const { unmount } = render(
      <DatasetFolderTree
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        datasets={datasets as any}
        activeUserDatasetId="d3"
        loadingId={null}
        onSelectDataset={vi.fn()}
        onDatasetsRemoved={onDatasetsRemoved}
      />,
    );

    // Start a delete — hides the row and arms the 5-second timer.
    fireEvent.click(screen.getByTestId("btn-delete-dataset-d3"));
    fireEvent.click(screen.getByTestId("confirm-delete-confirm"));

    // Unmount *before* the undo window elapses.
    expect(deleteDatasetMutate).not.toHaveBeenCalled();
    act(() => { unmount(); });

    // The component's cleanup effect must have flushed the commit immediately.
    expect(deleteDatasetMutate).toHaveBeenCalledTimes(1);

    // Simulate the mutation's onSuccess to verify downstream effects also fire.
    const opts = deleteDatasetMutate.mock.calls[0]![1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d3", "terrain"],
    });
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d3", "overview"],
    });
    expect(onDatasetsRemoved).toHaveBeenCalledWith(["d3"]);
  });
});

describe("DatasetFolderTree — invalidation contract on delete", () => {
  beforeEach(() => {
    deleteDatasetMutate.mockReset();
    deleteFolderMutate.mockReset();
    invalidateQueries.mockReset();
    removeQueries.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts per-dataset terrain/overview cache and notifies parent on single delete", () => {
    const onDatasetsRemoved = vi.fn();
    render(
      <DatasetFolderTree
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        datasets={datasets as any}
        activeUserDatasetId="d3"
        loadingId={null}
        onSelectDataset={vi.fn()}
        onDatasetsRemoved={onDatasetsRemoved}
      />,
    );

    // Click the row's ✕ to open the confirm dialog, then confirm.
    fireEvent.click(screen.getByTestId("btn-delete-dataset-d3"));
    fireEvent.click(screen.getByTestId("confirm-delete-confirm"));

    // The mutation does not fire immediately — there's an undo window first.
    expect(deleteDatasetMutate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    // Simulate the mutation's onSuccess firing.
    expect(deleteDatasetMutate).toHaveBeenCalledTimes(1);
    const opts = deleteDatasetMutate.mock.calls[0]![1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    // Per-dataset terrain + overview caches are evicted for the deleted id.
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d3", "terrain"],
    });
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d3", "overview"],
    });

    // List queries are invalidated so DatasetPanel + folder tree refresh.
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["user-folders"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["user-datasets"] });

    // Parent is told which ids went away so it can clear active state.
    expect(onDatasetsRemoved).toHaveBeenCalledWith(["d3"]);
  });

  it("evicts all descendant dataset caches on recursive folder delete", () => {
    const onDatasetsRemoved = vi.fn();
    render(
      <DatasetFolderTree
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        datasets={datasets as any}
        activeUserDatasetId="d1"
        loadingId={null}
        onSelectDataset={vi.fn()}
        onDatasetsRemoved={onDatasetsRemoved}
      />,
    );

    fireEvent.click(screen.getByTestId("btn-delete-folder-f1"));
    fireEvent.click(screen.getByTestId("confirm-delete-confirm"));

    // The mutation does not fire immediately — there's an undo window first.
    expect(deleteFolderMutate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(deleteFolderMutate).toHaveBeenCalledTimes(1);
    const opts = deleteFolderMutate.mock.calls[0]![1] as { onSuccess: () => void };
    act(() => opts.onSuccess());

    // Both datasets that lived inside f1 have their caches evicted.
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d1", "terrain"],
    });
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d2", "terrain"],
    });
    // The unrelated root dataset is left alone.
    expect(removeQueries).not.toHaveBeenCalledWith({
      queryKey: ["user-datasets", "d3", "terrain"],
    });

    expect(onDatasetsRemoved).toHaveBeenCalledTimes(1);
    const removed = onDatasetsRemoved.mock.calls[0]![0] as string[];
    expect(new Set(removed)).toEqual(new Set(["d1", "d2"]));
  });
});
