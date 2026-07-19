/**
 * Guard test: bulkDeleteInFlightRef prevents a rapid double-signal from
 * queuing a second mutation batch while the first undo window is still open.
 *
 * Scenario:
 *   1. One dataset is selected in the tree.
 *   2. bulkDeleteSignal is bumped to 1 → handleBulkDelete fires, sets
 *      bulkDeleteInFlightRef = true, queues a deleteDataset.mutate behind a
 *      5 s undo timer.
 *   3. Before the timer expires, bulkDeleteSignal is bumped to 2 → the effect
 *      fires again but the in-flight guard short-circuits it.
 *   4. After advancing fake timers past the undo window both mutations are
 *      drained → deleteDataset.mutate was called exactly once.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// ── API client mock factory ────────────────────────────────────────────────
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
            `/api/mock/${(a as (string | undefined)[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) {
        return typeof p !== "symbol";
      },
    });
});

// Spy captured in hoisted scope so the vi.mock factory below can reference it.
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

// ── Fixtures ────────────────────────────────────────────────────────────────

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

// ── Test ────────────────────────────────────────────────────────────────────

describe("DatasetFolderTree bulk-delete double-fire guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deleteDatasetMutate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires deleteDataset.mutate exactly once on rapid double-signal", async () => {
    const { rerender } = render(
      <DatasetFolderTree
        datasets={[DS_A]}
        activeUserDatasetId={null}
        loadingId={null}
        onSelectDataset={() => {}}
        bulkDeleteSignal={0}
      />,
    );

    // Select the dataset by clicking its checkbox (role="checkbox").
    const checkbox = screen.getByTestId(`btn-user-dataset-${DS_A.id}`)
      .querySelector('[role="checkbox"]') as HTMLElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      fireEvent.click(checkbox);
    });

    // Signal 1 — triggers handleBulkDelete, sets in-flight guard.
    await act(async () => {
      rerender(
        <DatasetFolderTree
          datasets={[DS_A]}
          activeUserDatasetId={null}
          loadingId={null}
          onSelectDataset={() => {}}
          bulkDeleteSignal={1}
        />,
      );
    });

    // Signal 2 — should be blocked by bulkDeleteInFlightRef.
    await act(async () => {
      rerender(
        <DatasetFolderTree
          datasets={[DS_A]}
          activeUserDatasetId={null}
          loadingId={null}
          onSelectDataset={() => {}}
          bulkDeleteSignal={2}
        />,
      );
    });

    // Advance past the 5 s undo window so the commit closure runs.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    // Only one mutation should have been queued regardless of double-signal.
    expect(deleteDatasetMutate).toHaveBeenCalledTimes(1);
    expect(deleteDatasetMutate).toHaveBeenCalledWith(
      { id: DS_A.id },
      expect.any(Object),
    );
  });
});
