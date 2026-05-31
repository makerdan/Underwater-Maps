/**
 * Unit tests for useUndoableMarkerDelete covering the three behaviours that
 * define the undo-toast pattern used by all soft-deletes in this app:
 *
 *  1. Optimistic removal  — the cache is updated immediately so the marker
 *     disappears from the list before the DELETE reaches the server.
 *  2. Undo restores cache — clicking "Undo" in the toast cancels the timer
 *     and puts the snapshot back, with no DELETE ever sent.
 *  3. Flush on unmount   — if the component unmounts before the window
 *     elapses the DELETE is sent immediately so the server is never skipped.
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
      fakeCache.set(k, (updaterOrValue as (p: unknown) => unknown)(fakeCache.get(k)));
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

const deleteMutate = vi.fn();
vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useDeleteMarkersId: () => ({ mutate: deleteMutate }),
    getGetMarkersQueryKey: ({ datasetId }: { datasetId: string }) => ["markers", datasetId],
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
const MARKERS_KEY = ["markers", "ds-1"];
const INITIAL_MARKERS = [
  { id: "m1", label: "Point A" },
  { id: "m2", label: "Point B" },
];

function cacheGet() {
  return fakeCache.get(JSON.stringify(MARKERS_KEY)) as typeof INITIAL_MARKERS;
}

function getUndoOnClick() {
  const arg = toastFn.mock.calls[0]![0] as {
    action: React.ReactElement<{ onClick: () => void }>;
  };
  return arg.action.props.onClick;
}

// ─── Tests ────────────────────────────────────────────────────────────────
import { useUndoableMarkerDelete } from "@/hooks/useUndoableMarkerDelete";

describe("useUndoableMarkerDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeCache.clear();
    fakeCache.set(JSON.stringify(MARKERS_KEY), [...INITIAL_MARKERS]);
    deleteMutate.mockReset();
    toastFn.mockReset();
    toastFn.mockReturnValue({ dismiss: dismissFn });
    dismissFn.mockReset();
    invalidateQueries.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("optimistically removes the target marker from the cache on requestDelete", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    expect(cacheGet().map((m) => m.id)).toEqual(["m2"]);
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("shows an undo toast without firing the DELETE immediately", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m2", label: "Point B" }, "ds-1");
    });

    expect(toastFn).toHaveBeenCalledOnce();
    expect(toastFn.mock.calls[0]![0]).toMatchObject({
      title: "Marker deleted",
    });
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("restores the cache and skips the DELETE when Undo is clicked", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    expect(cacheGet().map((m) => m.id)).toEqual(["m2"]);

    act(() => {
      getUndoOnClick()();
    });

    expect(cacheGet().map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("fires the DELETE after the undo window elapses without an undo", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    expect(deleteMutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(deleteMutate).toHaveBeenCalledOnce();
    expect(deleteMutate.mock.calls[0]![0]).toEqual({ id: "m1" });
  });

  it("invalidates the marker query on successful DELETE", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    const opts = deleteMutate.mock.calls[0]![1] as { onSuccess: () => void };
    act(() => {
      opts.onSuccess();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: MARKERS_KEY,
    });
  });

  it("flushes pending deletes on unmount — fires DELETE before the window elapses", () => {
    const { result, unmount } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    expect(deleteMutate).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(deleteMutate).toHaveBeenCalledOnce();
    expect(deleteMutate.mock.calls[0]![0]).toEqual({ id: "m1" });
  });

  it("restores cache on DELETE error", () => {
    const { result } = renderHook(() => useUndoableMarkerDelete());

    act(() => {
      result.current({ id: "m1", label: "Point A" }, "ds-1");
    });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    const opts = deleteMutate.mock.calls[0]![1] as { onError: () => void };
    act(() => {
      opts.onError();
    });

    expect(cacheGet().map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
