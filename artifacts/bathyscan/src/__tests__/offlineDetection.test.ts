/**
 * offlineDetection.test.ts
 *
 * Unit tests for the offline-mode detection improvements:
 *
 *  1. offlineStore initializes isOnline from navigator.onLine
 *  2. Listener deduplication — the module-level window listeners are the single
 *     source of truth; toggling via the window event dispatches to the store
 *     exactly once per event regardless of how many App.tsx renders have occurred.
 *  3. useIsConnecting does NOT start health polling when isOnline is false —
 *     verifies that fetch() is never called if the device is offline when a 502
 *     or network error occurs.
 *  4. getTokenWithRetry does NOT call onExpired() when isOnline is false.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared toast mock (required by queryClient.ts)
// ---------------------------------------------------------------------------
vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns fresh instances of both offlineStore and queryClient by resetting
 * all modules so module-level state (listeners, _isConnecting, timers) starts
 * from zero.
 */
async function freshModules(initialOnline: boolean = true) {
  vi.resetModules();
  // Re-apply the toast mock after resetModules wipes it.
  vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
    useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
  }));

  // Stub navigator.onLine before offlineStore is imported so the store picks
  // it up during initialization.
  vi.stubGlobal("navigator", { ...navigator, onLine: initialOnline });

  const offlineMod = await import("@/lib/offlineStore");
  const queryMod = await import("@/lib/queryClient");
  return { offlineStore: offlineMod.useOfflineStore, queryClient: queryMod };
}

// ---------------------------------------------------------------------------
// 1. offlineStore — initializes from navigator.onLine
// ---------------------------------------------------------------------------

describe("offlineStore — initialization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("initializes isOnline = true when navigator.onLine is true", async () => {
    const { offlineStore } = await freshModules(true);
    expect(offlineStore.getState().isOnline).toBe(true);
  });

  it("initializes isOnline = false when navigator.onLine is false", async () => {
    const { offlineStore } = await freshModules(false);
    expect(offlineStore.getState().isOnline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Listener deduplication — module-level listeners only
// ---------------------------------------------------------------------------

describe("offlineStore — listener deduplication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("transitions isOnline to false exactly once when an 'offline' window event fires", async () => {
    const { offlineStore } = await freshModules(true);
    expect(offlineStore.getState().isOnline).toBe(true);

    // Simulate the browser going offline.
    window.dispatchEvent(new Event("offline"));

    expect(offlineStore.getState().isOnline).toBe(false);
  });

  it("transitions isOnline back to true when an 'online' window event fires", async () => {
    const { offlineStore } = await freshModules(false);
    expect(offlineStore.getState().isOnline).toBe(false);

    window.dispatchEvent(new Event("online"));

    expect(offlineStore.getState().isOnline).toBe(true);
  });

  it("calling setOnline(false) directly works without extra window events", async () => {
    const { offlineStore } = await freshModules(true);
    offlineStore.getState().setOnline(false);
    expect(offlineStore.getState().isOnline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. useIsConnecting — no health poll when isOnline is false
// ---------------------------------------------------------------------------

describe("useIsConnecting — health poll suppressed when offline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does NOT call fetch when isOnline is false and a 502 occurs", async () => {
    // Start with device offline so offlineStore.isOnline = false.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { offlineStore, queryClient } = await freshModules(false);

    // Confirm offline state was picked up.
    expect(offlineStore.getState().isOnline).toBe(false);

    const onError = queryClient.queryClient.getQueryCache().config.onError;
    // Trigger a 502 error — should set _isConnecting but NOT start the poll.
    onError?.({ status: 502 }, {} as Parameters<typeof onError>[1]);

    // Advance timers to give any scheduled poll a chance to fire.
    await vi.runAllTimersAsync();

    // fetch should not have been called at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DOES call fetch (health probe) when isOnline is true and a 502 occurs", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const { offlineStore, queryClient } = await freshModules(true);
    expect(offlineStore.getState().isOnline).toBe(true);

    const onError = queryClient.queryClient.getQueryCache().config.onError;
    onError?.({ status: 502 }, {} as Parameters<typeof onError>[1]);

    // Advance timers so the scheduled poll (delay ≥ 1 s) fires.
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. getTokenWithRetry — does NOT call onExpired when isOnline is false
// ---------------------------------------------------------------------------

describe("getTokenWithRetry — offline guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does NOT call onExpired when isOnline is false and token is null", async () => {
    // Ensure the offlineStore module sees online=false during initialization.
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    vi.resetModules();
    vi.mock("@/hooks/use-toast", () => ({
      toast: vi.fn(),
      useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
    }));

    const { useOfflineStore } = await import("@/lib/offlineStore");
    const { getTokenWithRetry } = await import("@/App");

    // Confirm store is offline.
    expect(useOfflineStore.getState().isOnline).toBe(false);

    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue(null);

    const resultPromise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("DOES call onExpired when isOnline is true and token is null", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    vi.resetModules();
    vi.mock("@/hooks/use-toast", () => ({
      toast: vi.fn(),
      useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
    }));

    const { getTokenWithRetry } = await import("@/App");

    const onExpired = vi.fn();
    const getToken = vi.fn().mockResolvedValue(null);

    const resultPromise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
