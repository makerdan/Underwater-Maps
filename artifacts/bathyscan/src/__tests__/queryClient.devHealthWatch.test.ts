/**
 * queryClient.devHealthWatch.test.ts
 *
 * Unit tests for startDevHealthWatch() — the dev-only proactive health ping
 * that makes the API-down banner appear even before any screen has fetched
 * anything.
 *
 *  1. An immediate probe fires at watch start; a failure flips the connecting
 *     flag (banner shows) and hands over to the exponential back-off poll,
 *     which fires reconnect on recovery.
 *  2. Healthy probes never change connectivity state.
 *  3. The returned stop function cancels the interval.
 *
 * Same fresh-module-per-test isolation pattern as queryClient.reconnect.test.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
}));

async function freshModule() {
  vi.resetModules();
  vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
    useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
  }));
  return await import("@/lib/queryClient");
}

function makeFetchResponse(ok: boolean, status = ok ? 200 : 502): Response {
  return {
    ok,
    status,
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startDevHealthWatch", () => {
  it("probes immediately on start; a failure flips connectivity and reconnect fires once the back-off poll recovers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      // Immediate watch probe fails …
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      // … back-off poll probe succeeds.
      .mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { startDevHealthWatch, subscribeToReconnect } = await freshModule();
    const reconnected = vi.fn();
    subscribeToReconnect(reconnected);

    const stop = startDevHealthWatch(5_000);

    // Immediate probe fails → connecting flag set → back-off poll starts (1 s).
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reconnected).toHaveBeenCalledTimes(1);

    stop();
  });

  it("a probe returning a non-OK status also flips connectivity", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeFetchResponse(false, 502))
      .mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { startDevHealthWatch, subscribeToReconnect } = await freshModule();
    const reconnected = vi.fn();
    subscribeToReconnect(reconnected);

    const stop = startDevHealthWatch(5_000);
    await vi.advanceTimersByTimeAsync(0);     // immediate probe fails (502)
    await vi.advanceTimersByTimeAsync(1_000); // back-off poll succeeds
    expect(reconnected).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not change state while probes stay healthy (and never fires reconnect)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { startDevHealthWatch, subscribeToReconnect } = await freshModule();
    const reconnected = vi.fn();
    subscribeToReconnect(reconnected);

    const stop = startDevHealthWatch(5_000);
    // Immediate probe + 4 interval probes over 20 s.
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(reconnected).not.toHaveBeenCalled();
    stop();
  });

  it("stop() cancels the interval — no further probes fire", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { startDevHealthWatch } = await freshModule();
    const stop = startDevHealthWatch(5_000);

    await vi.advanceTimersByTimeAsync(5_000); // immediate + 1 interval probe
    expect(fetchMock).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips its own probe while the back-off poll is already running (no double polling)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(false, 502));
    vi.stubGlobal("fetch", fetchMock);

    const { startDevHealthWatch } = await freshModule();
    const stop = startDevHealthWatch(5_000);

    // t=0: immediate watch probe fails → connecting; back-off poll takes over.
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterWatch = fetchMock.mock.calls.length;
    expect(callsAfterWatch).toBe(1);

    // Over the next 10 s the back-off poll fires (+1 s, +3 s, +7 s), but the
    // watch interval ticks at 5 s and 10 s must NOT add extra probes.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterWatch + 3);
    stop();
  });
});
