/**
 * Undo-toast contract tests for WeatherPanel's handleDeleteFolder.
 *
 * The three behaviours under test mirror the trail/marker undo pattern used
 * throughout the app:
 *
 *  1. Optimistic removal  — the folder (and its presets) disappear from the
 *     React Query cache the moment the user clicks "Delete", before the
 *     server DELETE is sent.
 *  2. Undo restores cache — clicking "Undo" in the toast cancels the timer
 *     and restores both caches to their snapshot, with no DELETE sent.
 *  3. Flush on unmount   — closing the WeatherPanel while the undo window is
 *     still open must immediately flush the DELETE so the server always
 *     receives it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const UNDO_WINDOW_MS = 5000;

// ─── computeDrift stub (required by WeatherPanel effects) ─────────────────
vi.mock("@/lib/computeDrift", () => ({
  computeDrift: () => [],
}));

// ─── Fake QueryClient ─────────────────────────────────────────────────────
const FOLDERS_KEY = ["trolling-preset-folders"];
const PRESETS_KEY = ["trolling-presets"];

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

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => qcMock,
}));

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

const deleteFolderMutate = vi.fn();

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({
    useGetTrollingPresets: () => ({ data: INITIAL_PRESETS }),
    useGetTrollingPresetFolders: () => ({ data: INITIAL_FOLDERS }),
    useDeleteTrollingPresetFoldersId: () => ({ mutate: deleteFolderMutate }),
    getGetTrollingPresetsQueryKey: () => PRESETS_KEY,
    getGetTrollingPresetFoldersQueryKey: () => FOLDERS_KEY,
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
  }) => React.createElement("button", { "data-testid": "undo-action", onClick }, children),
}));

// ─── App state / stores ───────────────────────────────────────────────────
const terrain = {
  datasetId: "ds-1",
  minLat: 0,
  maxLat: 1,
  minLon: 0,
  maxLon: 1,
  resolution: 2,
  depths: new Float32Array([10, 10, 10, 10]),
};

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain }),
}));

vi.mock("@/hooks/useSurfaceConditions", () => ({
  useSurfaceConditions: () => ({
    data: { tidalDataSource: "estimated" },
    hours: [],
    loading: false,
    error: false,
    estimated: false,
    refetch: vi.fn(),
  }),
}));

// ─── Test data ────────────────────────────────────────────────────────────
const INITIAL_FOLDERS = [{ id: "f1", name: "Lake Presets" }];
const INITIAL_PRESETS = [
  { id: "p1", name: "Slow troll", folderId: "f1", headingDeg: 0, speedKnots: 2, sortOrder: 0 },
  { id: "p2", name: "Fast troll", folderId: "f1", headingDeg: 180, speedKnots: 4, sortOrder: 1 },
  { id: "p3", name: "Root preset", folderId: null, headingDeg: 90, speedKnots: 3, sortOrder: 0 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function cacheGet(key: unknown[]) {
  return fakeCache.get(JSON.stringify(key));
}

function getUndoOnClick() {
  const arg = toastFn.mock.calls[0]![0] as {
    action: React.ReactElement<{ onClick: () => void }>;
  };
  return arg.action.props.onClick;
}

// Late import so mocks are already registered.
import { WeatherPanel } from "@/components/WeatherPanel";
import { useDriftStore } from "@/lib/driftStore";

describe("WeatherPanel — handleDeleteFolder undo toast contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    fakeCache.clear();
    fakeCache.set(JSON.stringify(FOLDERS_KEY), [...INITIAL_FOLDERS]);
    fakeCache.set(JSON.stringify(PRESETS_KEY), [...INITIAL_PRESETS]);

    deleteFolderMutate.mockReset();
    toastFn.mockReset();
    toastFn.mockReturnValue({ dismiss: dismissFn });
    dismissFn.mockReset();
    invalidateQueries.mockReset();

    useDriftStore.setState({
      driftConditions: null,
      driftPath: null,
      driftHour: 0,
      driftStartLat: 0.5,
      driftStartLon: 0.5,
      lineLengthM: 200,
      lineWeightG: 500,
      estimatedConditions: false,
      driftMode: "trolling",
      boatHeadingDeg: 0,
      boatSpeedKnots: 0,
      driftWaypoints: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("optimistically removes the folder from the cache without firing DELETE", () => {
    render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    const folders = cacheGet(FOLDERS_KEY) as typeof INITIAL_FOLDERS;
    expect(folders.find((f) => f.id === "f1")).toBeUndefined();

    expect(deleteFolderMutate).not.toHaveBeenCalled();
  });

  it("moves the folder's presets to root in the cache optimistically", () => {
    render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    const presets = cacheGet(PRESETS_KEY) as typeof INITIAL_PRESETS;
    const movedToRoot = presets.filter((p) => p.id === "p1" || p.id === "p2");
    expect(movedToRoot.every((p) => p.folderId === null)).toBe(true);

    const rootPreset = presets.find((p) => p.id === "p3");
    expect(rootPreset?.folderId).toBeNull();
  });

  it("restores both caches and fires no DELETE when the user clicks Undo", () => {
    render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    expect(deleteFolderMutate).not.toHaveBeenCalled();

    act(() => {
      getUndoOnClick()();
    });

    const folders = cacheGet(FOLDERS_KEY) as typeof INITIAL_FOLDERS;
    expect(folders.find((f) => f.id === "f1")).toBeDefined();

    const presets = cacheGet(PRESETS_KEY) as typeof INITIAL_PRESETS;
    expect(presets.filter((p) => p.folderId === "f1").map((p) => p.id)).toEqual(
      expect.arrayContaining(["p1", "p2"]),
    );

    expect(deleteFolderMutate).not.toHaveBeenCalled();
  });

  it("fires DELETE after the undo window elapses without an undo", () => {
    render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    expect(deleteFolderMutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    expect(deleteFolderMutate).toHaveBeenCalledOnce();
    expect(deleteFolderMutate.mock.calls[0]![0]).toEqual({ id: "f1" });
  });

  it("flushes the pending DELETE on unmount — server receives DELETE before window elapses", () => {
    const { unmount } = render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    expect(deleteFolderMutate).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(deleteFolderMutate).toHaveBeenCalledOnce();
    expect(deleteFolderMutate.mock.calls[0]![0]).toEqual({ id: "f1" });
  });

  it("invalidates both caches on successful DELETE", () => {
    render(<WeatherPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Lake Presets" }));

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });

    const opts = deleteFolderMutate.mock.calls[0]![1] as {
      onSuccess: () => Promise<void>;
    };
    act(() => {
      void opts.onSuccess();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: FOLDERS_KEY });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: PRESETS_KEY });
  });
});
