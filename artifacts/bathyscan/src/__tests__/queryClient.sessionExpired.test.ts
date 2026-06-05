/**
 * queryClient.sessionExpired.test.ts
 *
 * Unit tests for the session-expired signal added to queryClient.ts.
 *
 * Three behaviours are verified:
 *  1. Pre-load 401s (Clerk not yet attached) do NOT count toward the threshold.
 *  2. Post-load 401s (setClerkLoaded(true) called) increment the counter and
 *     fire signalSessionExpired() once the threshold is reached.
 *  3. signalSessionExpired() can be called directly (e.g. by ClerkAuthTokenWirer)
 *     and also notifies all subscribers exactly once.
 *  4. A successful query resets the consecutive-401 counter so a brief auth
 *     blip doesn't permanently trip the threshold.
 *
 * Uses the same vi.resetModules() + dynamic import isolation pattern as
 * queryClient.reconnect.test.ts so each test starts with a clean module
 * instance (fresh counters, fresh listener sets).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
  useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
}));

async function freshModule(): Promise<{
  setClerkLoaded: (loaded: boolean) => void;
  signalSessionExpired: () => void;
  subscribeToSessionExpired: (cb: () => void) => () => void;
  queryClient: import("@tanstack/react-query").QueryClient;
}> {
  vi.resetModules();
  vi.mock("@/hooks/use-toast", () => ({
    toast: vi.fn(),
    useToast: vi.fn(() => ({ toast: vi.fn(), toasts: [] })),
  }));
  const mod = await import("@/lib/queryClient");
  return mod as typeof mod;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pre-load 401s — suppressed", () => {
  it("does not fire session-expired when Clerk is not yet loaded", async () => {
    const { queryClient, subscribeToSessionExpired } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);

    const onError = queryClient.getQueryCache().config.onError;
    for (let i = 0; i < 10; i++) {
      onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    }

    expect(cb).not.toHaveBeenCalled();
  });

  it("resets the 401 counter when setClerkLoaded(false) is called", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);

    const onError = queryClient.getQueryCache().config.onError;

    setClerkLoaded(true);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    setClerkLoaded(false);

    setClerkLoaded(true);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("post-load 401s — threshold tracking", () => {
  it("does not fire before the threshold is reached", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);
    setClerkLoaded(true);

    const onError = queryClient.getQueryCache().config.onError;
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    expect(cb).not.toHaveBeenCalled();
  });

  it("fires exactly once when the threshold (3 consecutive 401s) is crossed", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);
    setClerkLoaded(true);

    const onError = queryClient.getQueryCache().config.onError;
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    expect(cb).not.toHaveBeenCalled();

    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire the signal more than once regardless of additional 401s", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);
    setClerkLoaded(true);

    const onError = queryClient.getQueryCache().config.onError;
    for (let i = 0; i < 20; i++) {
      onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    }

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("notifies all subscribers when the signal fires", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    subscribeToSessionExpired(cb1);
    subscribeToSessionExpired(cb2);
    setClerkLoaded(true);

    const onError = queryClient.getQueryCache().config.onError;
    for (let i = 0; i < 3; i++) {
      onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    }

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("does not fire after subscriber unsubscribes", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    const unsub = subscribeToSessionExpired(cb);
    unsub();
    setClerkLoaded(true);

    const onError = queryClient.getQueryCache().config.onError;
    for (let i = 0; i < 3; i++) {
      onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    }

    expect(cb).not.toHaveBeenCalled();
  });
});

describe("successful query resets the 401 counter", () => {
  it("does not fire after a success resets the counter mid-stream", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);
    setClerkLoaded(true);

    const cache = queryClient.getQueryCache();
    const onError = cache.config.onError;
    const onSuccess = cache.config.onSuccess;

    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    onSuccess?.({} as Parameters<typeof onSuccess>[0], {} as Parameters<typeof onSuccess>[1]);

    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);

    expect(cb).not.toHaveBeenCalled();
  });

  it("fires after reset if three fresh 401s arrive", async () => {
    const { queryClient, subscribeToSessionExpired, setClerkLoaded } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);
    setClerkLoaded(true);

    const cache = queryClient.getQueryCache();
    const onError = cache.config.onError;
    const onSuccess = cache.config.onSuccess;

    onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    onSuccess?.({} as Parameters<typeof onSuccess>[0], {} as Parameters<typeof onSuccess>[1]);

    for (let i = 0; i < 3; i++) {
      onError?.({ status: 401 }, {} as Parameters<typeof onError>[1]);
    }

    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("signalSessionExpired() — direct call", () => {
  it("fires all subscribers immediately", async () => {
    const { signalSessionExpired, subscribeToSessionExpired } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);

    signalSessionExpired();

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — second call does not re-notify", async () => {
    const { signalSessionExpired, subscribeToSessionExpired } = await freshModule();
    const cb = vi.fn();
    subscribeToSessionExpired(cb);

    signalSessionExpired();
    signalSessionExpired();

    expect(cb).toHaveBeenCalledTimes(1);
  });
});
