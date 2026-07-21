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

const { clerkAuthState, useGetSettingsMock } = vi.hoisted(() => {
  const clerkAuthState = { isSignedIn: true as boolean | null, isLoaded: true };
  const useGetSettingsMock = vi.fn((args?: unknown) => {
    const enabled =
      (args as { query?: { enabled?: boolean } } | undefined)?.query?.enabled ?? true;
    return {
      data: enabled ? { __updatedAt: "2026-01-01T00:00:00Z" } : undefined,
      isError: false,
    };
  });
  return { clerkAuthState, useGetSettingsMock };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: useGetSettingsMock,
  usePutSettings: () => ({ mutateAsync: mutateAsyncFn }),
  getGetSettingsQueryKey: () => ["Settings"],
}));

vi.mock("@/lib/clerkCompat", () => ({
  useUser: () => ({ ...clerkAuthState }),
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

import {
  useServerSettingsSync,
  requestSettingsSync,
  flushServerSync,
  hasUnackedSettingsEdits,
} from "@/hooks/useServerSettingsSync";

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

// ── Tests — immediate flush (onboarding Skip) ordering ───────────────────────
//
// Covers the onboarding Skip flow: Skip sets hasSeenOnboarding:true locally
// then calls flushServerSync() immediately. Two invariants:
//   1. An immediate flush serializes strictly AFTER an already-in-flight
//      debounced PUT that carries an OLDER snapshot — and because the payload
//      is built fresh when its turn on the chain arrives, the final PUT (the
//      one the server processes last) carries the NEW flag value. A queued
//      old-snapshot PUT can never silently revert the Skip.
//   2. A failed immediate flush rejects to the caller (so it can retry) and
//      leaves hasUnackedSettingsEdits() true until a later flush succeeds —
//      the signal waitForServerSettingsSync uses to avoid reporting a failed
//      flush as "already synced".

describe("useServerSettingsSync — immediate flush (Skip) ordering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mutateAsyncFn.mockReset();
    mutateAsyncFn.mockResolvedValue({ __updatedAt: "2026-07-01T00:00:00Z" });
    toastFn.mockClear();
    (settingsStoreState as Record<string, unknown>)["hasSeenOnboarding"] = false;
  });

  afterEach(() => {
    delete (settingsStoreState as Record<string, unknown>)["hasSeenOnboarding"];
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("serializes behind an in-flight old-snapshot PUT and sends the latest flag last", async () => {
    // First PUT (debounced, old snapshot) stays in flight until we resolve it.
    let resolveFirstPut: ((v: unknown) => void) | null = null;
    mutateAsyncFn.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstPut = resolve; }),
    );

    const { unmount } = renderHook(() => useServerSettingsSync());

    // Debounced sync fires with hasSeenOnboarding:false in the store.
    requestSettingsSync();
    await act(async () => {
      vi.advanceTimersByTime(350);
      await flushMicrotasks();
    });
    expect(mutateAsyncFn).toHaveBeenCalledTimes(1);
    const firstPayload = (mutateAsyncFn.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(firstPayload["hasSeenOnboarding"]).toBe(false);

    // Skip: flip the flag locally, then flush immediately while PUT #1 is
    // still in flight.
    (settingsStoreState as Record<string, unknown>)["hasSeenOnboarding"] = true;
    const skipFlush = flushServerSync();
    await act(async () => { await flushMicrotasks(); });

    // The immediate flush must NOT fire a concurrent PUT — it queues on the
    // serialization chain behind the in-flight one.
    expect(mutateAsyncFn).toHaveBeenCalledTimes(1);

    // Let the old-snapshot PUT land; the Skip flush now runs and builds its
    // payload fresh — carrying the new flag.
    resolveFirstPut!({ __updatedAt: "2026-07-01T00:00:01Z" });
    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await skipFlush; });

    expect(mutateAsyncFn).toHaveBeenCalledTimes(2);
    const secondPayload = (mutateAsyncFn.mock.calls[1]![0] as { data: Record<string, unknown> }).data;
    expect(secondPayload["hasSeenOnboarding"]).toBe(true);

    unmount();
  });

  it("rejects to the caller on PUT failure and reports unacked edits until a later success", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());

    mutateAsyncFn.mockRejectedValueOnce(new Error("429 rate_limit"));
    (settingsStoreState as Record<string, unknown>)["hasSeenOnboarding"] = true;

    let rejected = false;
    await act(async () => {
      await flushServerSync().catch(() => { rejected = true; });
      await flushMicrotasks();
    });
    expect(rejected).toBe(true);
    // The failed flush must remain visible as dirty state — this is what
    // keeps waitForServerSettingsSync's fast path from resolving "synced".
    expect(hasUnackedSettingsEdits()).toBe(true);

    // A subsequent successful flush (the retry path) clears the signal.
    mutateAsyncFn.mockResolvedValueOnce({ __updatedAt: "2026-07-01T00:00:02Z" });
    await act(async () => {
      await flushServerSync();
      await flushMicrotasks();
    });
    expect(hasUnackedSettingsEdits()).toBe(false);

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

// ── Tests — isLoaded=false startup race guard ─────────────────────────────────

describe("useServerSettingsSync — isLoaded=false guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mutateAsyncFn.mockResolvedValue({ __updatedAt: "2026-07-01T00:00:00Z" });
    useGetSettingsMock.mockClear();
    settingsStoreState.hydrateFromServer.mockClear();
    clerkAuthState.isSignedIn = true;
    clerkAuthState.isLoaded = false;
  });

  afterEach(() => {
    clerkAuthState.isLoaded = true;
    clerkAuthState.isSignedIn = true;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not call hydrateFromServer when isLoaded=false (GET query is disabled)", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(settingsStoreState.hydrateFromServer).not.toHaveBeenCalled();
    unmount();
  });

  it("does not fire a PUT when isLoaded=false", async () => {
    const { unmount } = renderHook(() => useServerSettingsSync());
    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
    });
    expect(mutateAsyncFn).not.toHaveBeenCalled();
    unmount();
  });
});
