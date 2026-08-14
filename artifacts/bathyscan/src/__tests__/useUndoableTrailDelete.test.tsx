/**
 * Unit tests for useUndoableTrailDelete covering the three behaviours that
 * define the undo-toast pattern used for GPS trail deletes:
 *
 *  1. Optimistic removal  — the trail disappears from the cache immediately
 *     when requestDelete is called, before the DELETE reaches the server.
 *  2. Undo restores cache — clicking "Undo" in the toast cancels the timer
 *     and puts the snapshot back, with no DELETE ever sent.
 *  3. Flush on unmount   — if the component unmounts before the window
 *     elapses the DELETE is sent immediately so the server is never skipped.
 *
 * Trail delete is a distinct code path from marker delete: it uses a
 * different query key (getGetTrailsQueryKey), a different mutation
 * (useDeleteTrailsId), a separate toast title ("Trail deleted"), and calls
 * refetchTrails on success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const UNDO_WINDOW_MS = 5000;

// ─── Fake QueryClient ─────────────────────────────────────────────────────
const fakeCache = new Map<string, unknown>();
const invalidateQueries = vi.fn();
const qcMock = {
  getQueryData: (key: unknown[]) => fakeCache.get(JSON.stringify(key)),
  setQueryData: (
    key: unknown[],
    updaterOrValue: unknown | ((prev: unknown) => unknown),
  ) => {
    const k = JSON.stringify(key);
    if (typeof updaterOrValue === "function") {
      fakeCache.set(
        k,
        (updaterOrValue as (p: unknown) => unknown)(fakeCache.get(k)),
      );
    } else {
      fakeCache.set(k, updaterOrValue);
    }
  },
  invalidateQueries,
};

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => qcMock };
});

// ─── Mutation capture ─────────────────────────────────────────────────────
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() { return { data: undefined, isLoading: false, isError: false, refetch: noop }; }
  function mutationHook() { return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false, variables: undefined }; }
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
          return (...a: unknown[]) => `/api/mock/${(a as unknown[]).filter(Boolean).join("/")}`;
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

const deleteTrailMutate = vi.fn();
vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useDeleteTrailsId: () => ({ mutate: deleteTrailMutate }),
    getGetTrailsQueryKey: ({ datasetId }: { datasetId: string }) => ["trails", datasetId],
  }),
);

// ─── Toast capture ────────────────────────────────────────────────────────
const dismissFn = vi.fn();
const toastFn = vi.fn().mockReturnValue({ dismiss: dismissFn });
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: ({
    onClick,
    children,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    altText: string;
  }) => React.createElement("button", { onClick }, children),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────
const DATASET_ID = "ds-survey-1";
const TRAILS_KEY = ["trails", DATASET_ID];
const INITIAL_TRAILS = [
  { id: "t1", name: "North Pass" },
  { id: "t2", name: "South Ridge" },
];

function cacheGet() {
  return fakeCache.get(JSON.stringify(TRAILS_KEY)) as typeof INITIAL_TRAILS;
}

function getUndoOnClick() {
  const arg = toastFn.mock.calls[0]![0] as {
    action: React.ReactElement<{ onClick: () => void }>;
  };
  return arg.action.props.onClick;
}

// ─── Tests ────────────────────────────────────────────────────────────────
import { useUndoableTrailDelete } from "@/hooks/useUndoableTrailDelete";

describe("useUndoableTrailDelete", () => {
  let refetchTrails: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeCache.clear();
    fakeCache.set(JSON.stringify(TRAILS_KEY), [...INITIAL_TRAILS]);
    deleteTrailMutate.mockReset();
    toastFn.mockReset();
    toastFn.mockReturnValue({ dismiss: dismissFn });
    dismissFn.mockReset();
    invalidateQueries.mockReset();
    refetchTrails = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("optimistically removes the target trail from the cache on requestDelete", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    expect(cacheGet().map((t) => t.id)).toEqual(["t2"]);
    expect(deleteTrailMutate).not.toHaveBeenCalled();
  });

  it("shows a 'Trail deleted' undo toast without firing DELETE immediately", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    expect(toastFn).toHaveBeenCalledOnce();
    expect(toastFn.mock.calls[0]![0]).toMatchObject({
      title: "Trail deleted",
      description: '"North Pass" will be removed.',
    });
    expect(deleteTrailMutate).not.toHaveBeenCalled();
  });

  it("restores the cache and fires no DELETE when the user clicks Undo", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    expect(cacheGet().map((t) => t.id)).toEqual(["t2"]);

    act(() => {
      getUndoOnClick()();
    });

    expect(cacheGet().map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(deleteTrailMutate).not.toHaveBeenCalled();
  });

  it("fires DELETE after the undo window elapses without an undo", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t2", "South Ridge");
    });

    expect(deleteTrailMutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();
    expect(deleteTrailMutate.mock.calls[0]![0]).toEqual({ id: "t2" });
  });

  it("invalidates the trails query and calls refetchTrails on successful DELETE", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    const opts = deleteTrailMutate.mock.calls[0]![1] as {
      onSuccess: () => void;
    };
    act(() => {
      opts.onSuccess();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: TRAILS_KEY,
    });
    expect(refetchTrails).toHaveBeenCalledOnce();
  });

  it("flushes the pending DELETE on unmount — server receives DELETE before window elapses", () => {
    const { result, unmount } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    expect(deleteTrailMutate).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();
    expect(deleteTrailMutate.mock.calls[0]![0]).toEqual({ id: "t1" });
  });

  // ── New regression tests for the three undo-delete bugs ─────────────────

  it("commit is one-shot — double commit does not fire DELETE twice", () => {
    // Regression: if the timer fires and the unmount flush also calls
    // entry.commit(), mutation.mutate must only be called once.
    const { result, unmount } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    // Advance the timer so the natural timeout commit fires first.
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();

    // Unmounting now should NOT fire a second mutate call.
    act(() => {
      unmount();
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();
  });

  it("same-ID requestDelete cancels the prior timer before replacing the entry", () => {
    // Regression: a second requestDelete for the same trail ID must cancel
    // the first timer so the first commit never fires while the second toast
    // is visible.
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    // First delete request.
    act(() => {
      result.current("t1", "North Pass");
    });

    expect(deleteTrailMutate).not.toHaveBeenCalled();

    // Second delete request for the same ID before the first timer fires.
    act(() => {
      result.current("t1", "North Pass again");
    });

    // Advance past the first window — the first timer must have been cancelled.
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    // Only one commit should have fired (from the second timer).
    expect(deleteTrailMutate).toHaveBeenCalledOnce();
    expect(deleteTrailMutate.mock.calls[0]![0]).toEqual({ id: "t1" });
  });

  it("unmount flush fires DELETE exactly once — timer does not double-fire afterward", () => {
    // Regression: the unmount cleanup must cancel the pending timer before
    // calling commit so that when fake timers later flush any remaining
    // callbacks, no second DELETE is issued.
    const { result, unmount } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    expect(deleteTrailMutate).not.toHaveBeenCalled();

    // Unmount mid-window — should fire commit immediately.
    act(() => {
      unmount();
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();

    // Drain any remaining timers — the cancelled timer must not re-fire.
    act(() => {
      vi.runAllTimers();
    });

    expect(deleteTrailMutate).toHaveBeenCalledOnce();
  });

  it("restores the cache on DELETE server error", () => {
    const { result } = renderHook(() =>
      useUndoableTrailDelete(DATASET_ID, refetchTrails),
    );

    act(() => {
      result.current("t1", "North Pass");
    });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    const opts = deleteTrailMutate.mock.calls[0]![1] as {
      onError: () => void;
    };
    act(() => {
      opts.onError();
    });

    expect(cacheGet().map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});
