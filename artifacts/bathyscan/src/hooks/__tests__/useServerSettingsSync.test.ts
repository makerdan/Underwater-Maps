/**
 * useServerSettingsSync — unit tests
 *
 * Covers:
 *   - Toast fires after exactly MAX_SILENT_FLUSH_FAILURES (3) consecutive PUT failures
 *   - Toast does NOT fire for fewer than 3 consecutive failures
 *   - Counter resets after a successful flush (so 3 fresh failures are required again)
 *   - Singleton DEV-mode warning fires when the hook is mounted a second time
 *   - Singleton warning is NOT emitted on the first (and only) mount
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Hoisted values (must be defined before any vi.mock factory runs) ──────────

const { mutateAsyncFn, toastFn } = vi.hoisted(() => {
  const mutateAsyncFn = vi.fn().mockResolvedValue({ __updatedAt: "2026-07-01T00:00:00Z" });
  const toastFn = vi.fn().mockReturnValue({ dismiss: vi.fn() });
  return { mutateAsyncFn, toastFn };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => ({
    data: { __updatedAt: "2026-01-01T00:00:00Z" },
    isError: false,
  }),
  usePutSettings: () => ({ mutateAsync: mutateAsyncFn }),
  getGetSettingsQueryKey: () => ["Settings"],
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastFn,
}));

// settingsStore — must include persist+setState+subscribe per memory note:
// uiStore.ts reads useSettingsStore.persist.hasHydrated() at module init.
const settingsStoreState = {
  hydrateFromServer: vi.fn(),
  markAllSaved: vi.fn(),
  resetSection: vi.fn(),
  resetAll: vi.fn(),
  setDatasetHome: vi.fn(),
  clearDatasetHome: vi.fn(),
  clearForSignOut: vi.fn(),
  datasetHomePositions: {},
  syncedSnapshot: null,
  lastSyncedAt: null,
  waterType: "saltwater",
};

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const useSettingsStore = Object.assign(
    (sel: (s: typeof settingsStoreState) => unknown) => sel(settingsStoreState),
    {
      getState: () => settingsStoreState,
      setState: vi.fn(),
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore, getDataSnapshot: () => ({}) };
});

const paletteStoreState = {
  rev: 0,
  hydrateFromServer: vi.fn(),
  reset: vi.fn(),
  shallow: "#0077b6",
  deep: "#03045e",
  customStops: null,
  bandColors: null,
  bandBoundaries: null,
};

vi.mock("@/lib/paletteStore", () => ({
  usePaletteStore: Object.assign(
    (sel: (s: typeof paletteStoreState) => unknown) => sel(paletteStoreState),
    {
      getState: () => paletteStoreState,
      subscribe: () => () => {},
    },
  ),
}));

const panelStoreState = { collapsed: {}, setCollapsed: vi.fn() };

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: Object.assign(
    (sel: (s: typeof panelStoreState) => unknown) => sel(panelStoreState),
    {
      getState: () => panelStoreState,
      setState: vi.fn(),
      subscribe: () => () => {},
    },
  ),
  DEFAULTS: {},
}));

const zoneStoreState = {
  saltwater: null,
  freshwater: null,
  hydrateFromServer: vi.fn(),
};

vi.mock("@/lib/zoneOverlayStore", () => ({
  useZoneOverlayStore: Object.assign(
    (sel: (s: typeof zoneStoreState) => unknown) => sel(zoneStoreState),
    {
      getState: () => zoneStoreState,
      subscribe: () => () => {},
    },
  ),
}));

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (_sel: unknown) => undefined,
    { setState: vi.fn() },
  ),
  CURRENT_DEPTH_LAYERS: ["surface", "mid", "bottom"],
}));

vi.mock("@/components/TidalCurrentArrows", () => ({}));

// ── Import under test (must come after all vi.mock() calls) ──────────────────

import { useServerSettingsSync, requestSettingsSync } from "@/hooks/useServerSettingsSync";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Drain the microtask queue enough to settle a single rejected async chain. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/**
 * Trigger N debounced flush cycles in sequence.
 * Each cycle:
 *   1. Enqueues a scheduleSync via requestSettingsSync()
 *   2. Advances the fake clock past the 300 ms debounce window
 *   3. Drains the microtask queue so the async flush().catch() chain settles
 */
async function triggerFlushCycles(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    requestSettingsSync();
    await act(async () => {
      vi.advanceTimersByTime(350);
      await flushMicrotasks();
    });
  }
}

// ── Tests — consecutive flush failures ───────────────────────────────────────

describe("useServerSettingsSync — consecutive flush failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: every PUT fails.
    mutateAsyncFn.mockRejectedValue(new Error("network error"));
    toastFn.mockClear();
    settingsStoreState.markAllSaved.mockClear();
    settingsStoreState.hydrateFromServer.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does NOT show a toast after only 1 consecutive failure", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());
    await triggerFlushCycles(1);
    expect(toastFn).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT show a toast after 2 consecutive failures", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());
    await triggerFlushCycles(2);
    expect(toastFn).not.toHaveBeenCalled();
    unmount();
  });

  it("shows a toast after exactly MAX_SILENT_FLUSH_FAILURES (3) consecutive failures", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());
    await triggerFlushCycles(3);
    expect(toastFn).toHaveBeenCalledTimes(1);
    expect(toastFn).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Settings not saving" }),
    );
    unmount();
  });

  it("resets the counter after a successful flush — 3 more failures needed for the next toast", async () => {
    // failures 1 & 2 → then a success → counter resets → 2 more failures stay silent
    mutateAsyncFn
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValueOnce({ __updatedAt: "2026-07-01T00:00:00Z" }) // success
      .mockRejectedValueOnce(new Error("fail 3"))
      .mockRejectedValueOnce(new Error("fail 4"));

    const { unmount } = renderHook(() => useServerSettingsSync());

    // 2 failures + 1 success (3 cycles total) — should never hit the threshold
    await triggerFlushCycles(3);
    expect(toastFn).not.toHaveBeenCalled();

    // 2 more failures — counter is at 2, still below the threshold of 3
    await triggerFlushCycles(2);
    expect(toastFn).not.toHaveBeenCalled();

    unmount();
  });

  it("counter resets after the toast fires so it does not spam on every subsequent failure", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());

    // First burst of 3 → toast fires once, counter resets to 0
    await triggerFlushCycles(3);
    expect(toastFn).toHaveBeenCalledTimes(1);

    // 2 more failures — counter is at 2, below the threshold again
    await triggerFlushCycles(2);
    expect(toastFn).toHaveBeenCalledTimes(1); // still only one toast

    unmount();
  });
});

// ── Tests — singleton DEV-mode warning ───────────────────────────────────────

describe("useServerSettingsSync — singleton DEV-mode warning", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mutateAsyncFn.mockResolvedValue({ __updatedAt: "2026-07-01T00:00:00Z" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does NOT emit the singleton warning on the first (and only) mount", () => {
    const { unmount } = renderHook(() => useServerSettingsSync());

    const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
    const warningCall = calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("mounted twice"),
    );
    expect(warningCall).toBeUndefined();

    unmount();
  });

  it("emits console.error when the hook is mounted a second time while already mounted", () => {
    const first = renderHook(() => useServerSettingsSync());
    // Mount a second instance — this is the disallowed concurrent mount.
    const second = renderHook(() => useServerSettingsSync());

    const calls = (console.error as ReturnType<typeof vi.spyOn>).mock.calls;
    const warningCall = calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("mounted twice"),
    );
    expect(warningCall).toBeDefined();

    second.unmount();
    first.unmount();
  });
});
