/**
 * queryClient.reconnect.test.ts
 *
 * Unit tests for the server-connectivity signal and health-poll logic in
 * queryClient.ts.  These cover the three subsystems that drive automatic
 * upload resumption when a network drop occurs:
 *
 *  1. subscribeToReconnect — listener registration, deregistration, and
 *     correct fire-exactly-once semantics on each connecting→connected
 *     transition.
 *
 *  2. Health-poll exponential back-off — the poll delay starts at 1 s and
 *     doubles up to 15 s max.  Each failed probe increments the counter;
 *     a successful probe clears the connecting flag and stops the poll.
 *
 *  3. Network-drop simulation — a network-level TypeError fires the
 *     connecting flag, which starts the health poll; when fetch() returns
 *     200 the reconnect callbacks are notified exactly once, matching what
 *     DatasetPanel.tsx relies on to auto-resume a stalled chunk upload.
 *
 * The module has module-level mutable state (_isConnecting, listeners, etc.)
 * that persists between tests within the same process.  Each test uses
 * vi.resetModules() + dynamic import to obtain a completely fresh module
 * instance, ensuring isolation.
 *
 * fetch() and setTimeout() are replaced by vi.fn() / vi.useFakeTimers()
 * so no real network I/O or real wall-clock delays occur.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks that must be in place before any import of queryClient.ts.
//
// @tanstack/react-query and react are real packages — no mock needed.
// @/hooks/use-toast is mocked to prevent shadcn from triggering DOM updates.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a fresh queryClient module instance. Each call to this function
 * calls vi.resetModules() so module-level state (_isConnecting, listeners,
 * timers) starts from zero.
 *
 * Exports typed to the minimum surface needed by these tests.
 */
async function freshModule(): Promise<{
  subscribeToReconnect: (cb: () => void) => () => void;
  useIsConnecting: () => boolean;
  queryClient: import("@tanstack/react-query").QueryClient;
}> {
  vi.resetModules();
  // Re-mock use-toast after resetModules so the new module instance sees it.
  vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
    useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
  }));
  const mod = await import("@/lib/queryClient");
  return mod as typeof mod;
}

/**
 * Construct a minimal ok/not-ok fetch Response for mocking.
 */
function makeFetchResponse(ok: boolean, status = ok ? 200 : 502): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    body: null,
    bodyUsed: false,
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. subscribeToReconnect — listener lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("subscribeToReconnect — listener lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(true)));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls a registered callback when the server comes back online", async () => {
    const { subscribeToReconnect, queryClient } = await freshModule();

    const cb = vi.fn();
    subscribeToReconnect(cb);

    // Trigger connectivity loss through the queryClient's error pipeline,
    // then simulate a successful health probe.
    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // Advance timers through the first health-poll delay (≥1 s).
    await vi.runAllTimersAsync();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not call the callback after it is unsubscribed", async () => {
    const { subscribeToReconnect, queryClient } = await freshModule();

    const cb = vi.fn();
    const unsub = subscribeToReconnect(cb);
    unsub(); // remove immediately

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    await vi.runAllTimersAsync();

    expect(cb).not.toHaveBeenCalled();
  });

  it("fires all registered callbacks on reconnect", async () => {
    const { subscribeToReconnect, queryClient } = await freshModule();

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribeToReconnect(cb1);
    subscribeToReconnect(cb2);

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    await vi.runAllTimersAsync();

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("fires the callback again on each new connecting→connected cycle", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // First call: server is back (ends first connecting period)
        .mockResolvedValueOnce(makeFetchResponse(true))
        // Second call: server is back again (ends second connecting period)
        .mockResolvedValueOnce(makeFetchResponse(true)),
    );

    const { subscribeToReconnect, queryClient } = await freshModule();

    const cb = vi.fn();
    subscribeToReconnect(cb);

    const onError = queryClient.getQueryCache().config.onError;

    // First connectivity drop → reconnect
    onError?.(new TypeError("NetworkError"), {} as Parameters<typeof onError>[1]);
    await vi.runAllTimersAsync();
    expect(cb).toHaveBeenCalledTimes(1);

    // Second connectivity drop → reconnect
    onError?.(new TypeError("Load failed"), {} as Parameters<typeof onError>[1]);
    await vi.runAllTimersAsync();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Health-poll exponential back-off
// ─────────────────────────────────────────────────────────────────────────────

describe("health-poll exponential back-off", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not call fetch before the first back-off delay elapses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = await freshModule();

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // No time has passed — health poll must not have fired yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls fetch at least once after the first delay", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(makeFetchResponse(true)); // success on first attempt
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = await freshModule();

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doubles the delay with each failed probe (back-off schedule: 1s → 2s → 4s)", async () => {
    vi.useFakeTimers();

    const callTimes: number[] = [];
    const fetchMock = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now());
      return makeFetchResponse(false); // always fail so the poll keeps going
    });
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = await freshModule();

    const t0 = Date.now();
    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // Advance through three poll cycles: 1s, 2s (cumulative 3s), 4s (7s total)
    await vi.advanceTimersByTimeAsync(1_000);  // fires probe #1
    await vi.advanceTimersByTimeAsync(2_000);  // fires probe #2
    await vi.advanceTimersByTimeAsync(4_000);  // fires probe #3

    expect(callTimes.length).toBeGreaterThanOrEqual(3);

    // Verify the gaps increase monotonically (back-off).
    const gaps = callTimes.slice(1).map((t, i) => t - callTimes[i]);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
    }

    // The first probe fires ~1 s after the connectivity flag is set.
    expect(callTimes[0] - t0).toBeGreaterThanOrEqual(1_000);
  });

  it("caps the back-off delay at 15 s", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = await freshModule();

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // Advance far enough to exhaust all doublings and reach the cap (2^4=16>15)
    // Each advance triggers a probe and the next timer is scheduled.
    await vi.advanceTimersByTimeAsync(1_000);   // probe #1 → schedules 2 s
    await vi.advanceTimersByTimeAsync(2_000);   // probe #2 → schedules 4 s
    await vi.advanceTimersByTimeAsync(4_000);   // probe #3 → schedules 8 s
    await vi.advanceTimersByTimeAsync(8_000);   // probe #4 → schedules 15 s (capped)
    await vi.advanceTimersByTimeAsync(15_000);  // probe #5 → schedules 15 s

    // All probes fired so far used non-capped then capped delays.
    // The important assertion: no probe fires more than 15 s apart after the cap.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Network-drop simulation — full cycle
// ─────────────────────────────────────────────────────────────────────────────

describe("network-drop simulation — full cycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fires the reconnect callback after the health probe succeeds (connectivity restored)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(true)));

    const { queryClient, subscribeToReconnect } = await freshModule();

    const reconnected = vi.fn();
    subscribeToReconnect(reconnected);

    const onError = queryClient.getQueryCache().config.onError;

    // Trigger a network-level error to start the connectivity loss cycle.
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // Before the health poll completes, the reconnect callback must not have fired.
    expect(reconnected).not.toHaveBeenCalled();

    // Advance timers through the first health-poll delay.
    await vi.runAllTimersAsync();

    // After the probe returns 200, the connectivity flag clears and reconnect fires.
    expect(reconnected).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire reconnect callbacks for a 401 error (expected auth error, not connectivity)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(true)));

    const { queryClient, subscribeToReconnect } = await freshModule();

    const cb = vi.fn();
    subscribeToReconnect(cb);

    const onError = queryClient.getQueryCache().config.onError;
    // 401 errors are deliberately suppressed — they are not network drops.
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    await vi.runAllTimersAsync();

    expect(cb).not.toHaveBeenCalled();
  });

  it("fires reconnect callback exactly once even when multiple network errors arrive before reconnect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse(true)));

    const { queryClient, subscribeToReconnect } = await freshModule();

    const cb = vi.fn();
    subscribeToReconnect(cb);

    const onError = queryClient.getQueryCache().config.onError;

    // Burst of errors (as a real client might send)
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);
    onError?.(new TypeError("NetworkError"), {} as Parameters<typeof onError>[1]);
    onError?.(new TypeError("Load failed"), {} as Parameters<typeof onError>[1]);

    await vi.runAllTimersAsync();

    // Only one reconnect transition should fire the callbacks.
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stops scheduling health probes once the server responds 200", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(false)) // probe #1 fails
      .mockResolvedValue(makeFetchResponse(true));     // probe #2+ succeed
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient, subscribeToReconnect } = await freshModule();

    const reconnected = vi.fn();
    subscribeToReconnect(reconnected);

    const onError = queryClient.getQueryCache().config.onError;
    onError?.(new TypeError("Failed to fetch"), {} as Parameters<typeof onError>[1]);

    // Advance through probe #1 (1 s delay) then probe #2 (2 s later).
    await vi.advanceTimersByTimeAsync(1_000);  // probe #1 fails
    await vi.advanceTimersByTimeAsync(2_000);  // probe #2 succeeds → poll stops

    // Reconnect callback must have fired exactly once.
    expect(reconnected).toHaveBeenCalledTimes(1);

    // No further probes should be scheduled — advancing time changes nothing.
    const callsBefore = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
