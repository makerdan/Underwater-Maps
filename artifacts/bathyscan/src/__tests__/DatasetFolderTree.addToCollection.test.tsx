/**
 * DatasetFolderTree — add-to-collection wiring + multi-select regression.
 *
 * Covers (per task "User-defined dataset collections"):
 *   1. Multi-select: with onAddToCollection wired, selecting datasets shows
 *      the "Add to collection" header button and clicking it fires the
 *      callback with every selected dataset id (folders excluded).
 *   2. The button is absent when onAddToCollection is not provided
 *      (prop is optional — existing mounts are unaffected).
 *   3. Regression guard: with the collections wiring present, multi-select
 *      still works and bulk delete still deletes the selected datasets
 *      (undo window elapsing → one mutation per dataset).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// ── API client mock factory (same pattern as datasetFolderTreeDoubleDeleteGuard) ──
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false };
  }
  function mutationHook() {
    return {
      mutate: noop,
      mutateAsync: noop,
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
          return (...a: unknown[]) =>
            `/api/mock/${(a as (string | undefined)[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

const deleteDatasetMutate = vi.hoisted(() => vi.fn());

vi.mock(
  "@workspace/api-client-react",
  () =>
    makeApiClientMock({
      useDeleteUserDatasetsId: () => ({
        mutate: deleteDatasetMutate,
        mutateAsync: deleteDatasetMutate,
        isPending: false,
        isSuccess: false,
        variables: undefined,
      }),
      useGetUserFolders: () => ({ data: [], isLoading: false }),
    }),
);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
  }),
  QueryClient: class {
    fetchQuery = vi.fn();
    invalidateQueries = vi.fn();
  },
  QueryCache: class {
    constructor(_opts?: unknown) {}
  },
  MutationCache: class {
    constructor(_opts?: unknown) {}
  },
}));

vi.mock("@/lib/clerkCompat", async () => {
  const { mockClerkCompat } = await import("@/__tests__/testHelpers.auth");
  return mockClerkCompat({
    useAuth: () => ({ isSignedIn: true, isLoaded: true }),
  });
});

vi.mock("@/lib/settingsStore", () => {
  const state = {
    units: "metric" as const,
    datasetFolderExpanded: {} as Record<string, boolean>,
  };
  const useSettingsStore = ((sel: (s: typeof state) => unknown) =>
    sel(state)) as ((sel: (s: typeof state) => unknown) => unknown) & {
    getState: () => typeof state;
    setState: (patch: Partial<typeof state>) => void;
    persist: { hasHydrated: () => boolean };
  };
  useSettingsStore.getState = () => state;
  useSettingsStore.setState = (patch) => Object.assign(state, patch);
  useSettingsStore.persist = { hasHydrated: () => true };
  return { useSettingsStore };
});

vi.mock("@/lib/contextMenuStore", () => ({
  useContextMenuStore: {
    getState: () => ({
      open: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
      isOpen: false,
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: () => ({ dismiss: vi.fn(), id: "t1" }),
  }),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useFocusTrap", () => ({
  useFocusTrap: () => ({ ref: { current: null } }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
    transform: null,
  }),
  useDroppable: () => ({
    setNodeRef: () => {},
    isOver: false,
  }),
  useSensor: () => ({}),
  useSensors: (..._args: unknown[]) => [],
  PointerSensor: class {},
  DragOverlay: ({ children }: { children?: React.ReactNode }) =>
    children ? React.createElement(React.Fragment, null, children) : null,
}));

import { DatasetFolderTree } from "@/components/DatasetFolderTree";
import type { UserDatasetMeta } from "@workspace/api-client-react";

function makeDataset(id: string): UserDatasetMeta {
  return {
    id,
    name: `Dataset ${id}`,
    folderId: null,
    createdAt: "2024-01-01T00:00:00Z",
    minDepth: 0,
    maxDepth: 100,
    waterType: "saltwater",
    georeferenced: true,
    dataSource: "user",
  } as unknown as UserDatasetMeta;
}

const DS_A = makeDataset("ds-alpha");
const DS_B = makeDataset("ds-beta");

function selectDataset(id: string) {
  const checkbox = screen
    .getByTestId(`btn-user-dataset-${id}`)
    .querySelector('[role="checkbox"]') as HTMLElement;
  expect(checkbox).not.toBeNull();
  fireEvent.click(checkbox);
}

describe("DatasetFolderTree add-to-collection", () => {
  beforeEach(() => {
    deleteDatasetMutate.mockClear();
  });

  it("fires onAddToCollection with all selected dataset ids", async () => {
    const onAddToCollection = vi.fn();
    render(
      <DatasetFolderTree
        datasets={[DS_A, DS_B]}
        activeUserDatasetId={null}
        loadingId={null}
        onSelectDataset={() => {}}
        onAddToCollection={onAddToCollection}
      />,
    );

    await act(async () => {
      selectDataset(DS_A.id);
    });
    await act(async () => {
      selectDataset(DS_B.id);
    });

    const btn = screen.getByTestId("btn-add-selected-to-collection");
    fireEvent.click(btn);
    expect(onAddToCollection).toHaveBeenCalledTimes(1);
    const ids = onAddToCollection.mock.calls[0]![0] as string[];
    expect(new Set(ids)).toEqual(new Set([DS_A.id, DS_B.id]));
  });

  it("does not render the button when onAddToCollection is not provided", async () => {
    render(
      <DatasetFolderTree
        datasets={[DS_A]}
        activeUserDatasetId={null}
        loadingId={null}
        onSelectDataset={() => {}}
      />,
    );
    await act(async () => {
      selectDataset(DS_A.id);
    });
    // Selection mode is active (cancel button present) but no collection button.
    expect(screen.getByTestId("btn-cancel-selection")).toBeInTheDocument();
    expect(screen.queryByTestId("btn-add-selected-to-collection")).not.toBeInTheDocument();
  });
});

describe("DatasetFolderTree multi-select regression with collections wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deleteDatasetMutate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bulk delete still deletes selected datasets when onAddToCollection is wired", async () => {
    const { rerender } = render(
      <DatasetFolderTree
        datasets={[DS_A, DS_B]}
        activeUserDatasetId={null}
        loadingId={null}
        onSelectDataset={() => {}}
        bulkDeleteSignal={0}
        onAddToCollection={() => {}}
      />,
    );

    await act(async () => {
      selectDataset(DS_A.id);
    });
    await act(async () => {
      selectDataset(DS_B.id);
    });

    await act(async () => {
      rerender(
        <DatasetFolderTree
          datasets={[DS_A, DS_B]}
          activeUserDatasetId={null}
          loadingId={null}
          onSelectDataset={() => {}}
          bulkDeleteSignal={1}
          onAddToCollection={() => {}}
        />,
      );
    });

    // Confirm dialog (if any) — bulk delete via signal skips confirm and uses
    // the undo window; advance past it to flush the queued mutations.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(deleteDatasetMutate).toHaveBeenCalledTimes(2);
  });
});
