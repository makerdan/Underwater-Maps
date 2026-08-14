/**
 * clerkAuthTokenWirerReconnect.test.tsx
 *
 * Component tests for ClerkAuthTokenWirer's reconnect subscription
 * (the `useOfflineStore.subscribe` effect that watches isOnline false→true).
 *
 * Covers:
 *  - Banner is cleared (isOfflineReadOnly set to false) the moment the device
 *    comes back online, without a page reload.
 *  - Token getter is re-invoked immediately on reconnect.
 *  - "token recovers" branch: signalSessionExpired is NOT called.
 *  - "token still null → signalSessionExpired" branch: signalSessionExpired IS called.
 *  - Subscription is inert when session is null (no setOfflineReadOnly call).
 *  - Subscription is inert on an online→online transition (no false→true edge).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useOfflineStore } from "@/lib/offlineStore";

// ── Hoisted mock values — must be declared before any vi.mock() call ──────────

const mockSignalSessionExpired = vi.hoisted(() => vi.fn());
const mockSetClerkLoaded = vi.hoisted(() => vi.fn());
const mockSetAuthTokenGetter = vi.hoisted(() => vi.fn());
const mockPersistOfflineIdentity = vi.hoisted(() => vi.fn());

/**
 * Per-test controllable getToken mock.
 * Vitest v3: vi.fn<TFunction>() accepts a single function-type generic.
 */
const mockGetToken = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

const mockSession = vi.hoisted(() => ({ getToken: mockGetToken }));
const mockUser = vi.hoisted(() => ({
  id: "user-test-id",
  firstName: "Test",
  lastName: "User",
  primaryEmailAddress: { emailAddress: "test@example.com" },
}));

/**
 * Mutable ref so individual tests can set session to null to verify
 * the subscription early-return guard (`if (!session) return`).
 */
const sessionRef = vi.hoisted(
  () => ({ current: null as typeof mockSession | null }),
);

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/clerkCompat", () => ({
  useClerk: () => ({ session: sessionRef.current }),
  useUser: () => ({ user: mockUser }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Show: () => null,
  SignIn: () => null,
  SignUp: () => null,
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  return {
    ...actual,
    signalSessionExpired: mockSignalSessionExpired,
    setClerkLoaded: mockSetClerkLoaded,
  };
});

// Proxy-based catch-all so any hook/util imported by App.tsx resolves safely.
const makeApiClientMock = vi.hoisted(() => {
  function noop() {}
  function queryHook() {
    return { data: undefined, isLoading: false, isError: false, refetch: noop };
  }
  function mutationHook() {
    return { mutate: noop, mutateAsync: noop, isPending: false, isSuccess: false };
  }
  return (overrides: Record<string, unknown> = {}) =>
    new Proxy(overrides, {
      get(t, p) {
        if (typeof p === "symbol" || p === "then" || p === "catch" || p === "finally")
          return undefined;
        const k = String(p);
        if (k in t) return t[k];
        if (k.startsWith("useGet")) return queryHook;
        if (/^use(Post|Put|Patch|Delete|Health|Poe)/.test(k)) return mutationHook;
        if (k.startsWith("getGet") && k.endsWith("QueryKey"))
          return (...a: unknown[]) => [k, ...a];
        if (/^get(Get|Post|Put|Patch|Delete).*Url$/.test(k)) return () => "/api/mock";
        return noop;
      },
      has(_t, p) { return typeof p !== "symbol"; },
    });
});

vi.mock("@workspace/api-client-react", () =>
  makeApiClientMock({ setAuthTokenGetter: mockSetAuthTokenGetter }),
);

vi.mock("@/lib/devAuth", () => ({
  DEV_AUTH_BYPASS: false,
}));

vi.mock("@/components/OfflineReadOnlyBanner", () => ({
  persistOfflineIdentity: mockPersistOfflineIdentity,
  OfflineReadOnlyBanner: () => null,
}));

// ── Import under test — after all vi.mock() calls ────────────────────────────
import { ClerkAuthTokenWirer } from "@/App";

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetOfflineStore() {
  act(() => {
    useOfflineStore.getState().setOnline(true);
    useOfflineStore.getState().setOfflineReadOnly(false);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClerkAuthTokenWirer — reconnect clears the offline banner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Restore a valid session for each test in this suite.
    sessionRef.current = mockSession;
    resetOfflineStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetOfflineStore();
  });

  it("sets isOfflineReadOnly to false the moment isOnline flips true — no page reload", async () => {
    mockGetToken.mockResolvedValue("tok-recovered");

    render(<ClerkAuthTokenWirer />);

    // Simulate going offline and entering read-only mode.
    await act(async () => {
      useOfflineStore.getState().setOnline(false);
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(true);

    // Device reconnects — the subscription should clear the banner immediately.
    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });

  it("re-invokes the token getter on reconnect (token recovers branch)", async () => {
    mockGetToken.mockResolvedValue("tok-recovered");

    render(<ClerkAuthTokenWirer />);

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
    });

    const callsBefore = mockGetToken.mock.calls.length;

    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    // getTokenWithRetry called it at least once (succeeded on first attempt).
    expect(mockGetToken.mock.calls.length).toBeGreaterThan(callsBefore);
    // Token returned a value → session-expired path must NOT fire.
    expect(mockSignalSessionExpired).not.toHaveBeenCalled();
  });

  it("fires signalSessionExpired when token is still null after reconnect", async () => {
    // Both getToken attempts return null → genuine expiry after reconnect.
    mockGetToken.mockResolvedValue(null);

    render(<ClerkAuthTokenWirer />);

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    // Banner is cleared (setOfflineReadOnly(false) runs synchronously before
    // the async getToken attempt, so isOfflineReadOnly is false regardless).
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
    // Both retry attempts returned null → session truly expired.
    expect(mockSignalSessionExpired).toHaveBeenCalledOnce();
  });

  it("does not fire signalSessionExpired when token recovers after reconnect", async () => {
    mockGetToken.mockResolvedValue("tok-healthy");

    render(<ClerkAuthTokenWirer />);

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
    expect(mockSignalSessionExpired).not.toHaveBeenCalled();
  });

  it("does not call setOfflineReadOnly when the transition is online→online (no false→true edge)", async () => {
    mockGetToken.mockResolvedValue("tok-ok");

    render(<ClerkAuthTokenWirer />);

    // Spy AFTER render so the initial auth-wiring effect is not counted.
    const spy = vi.spyOn(useOfflineStore.getState(), "setOfflineReadOnly");

    // Already online — a second setOnline(true) must not trigger the reconnect path.
    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(spy).not.toHaveBeenCalled();
    expect(mockSignalSessionExpired).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles multiple reconnect cycles without accumulating signalSessionExpired calls", async () => {
    // First cycle: token null → expiry
    mockGetToken.mockResolvedValue(null);

    render(<ClerkAuthTokenWirer />);

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
    });
    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(mockSignalSessionExpired).toHaveBeenCalledOnce();

    // Second cycle: token now healthy — no extra expiry signal
    mockGetToken.mockResolvedValue("tok-recovered");
    mockSignalSessionExpired.mockClear();

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
    });
    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(mockSignalSessionExpired).not.toHaveBeenCalled();
  });
});

describe("ClerkAuthTokenWirer — null session guard (subscription inert)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Null session — component's subscription effect early-returns.
    sessionRef.current = null;
    resetOfflineStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore session so other suites are unaffected.
    sessionRef.current = mockSession;
    resetOfflineStore();
  });

  it("does not call setOfflineReadOnly when session is null and device reconnects", async () => {
    render(<ClerkAuthTokenWirer />);

    await act(async () => {
      useOfflineStore.getState().setOnline(false);
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    const spy = vi.spyOn(useOfflineStore.getState(), "setOfflineReadOnly");

    // Reconnect with null session — subscription was never registered.
    await act(async () => {
      useOfflineStore.getState().setOnline(true);
      await vi.runAllTimersAsync();
    });

    expect(spy).not.toHaveBeenCalled();
    expect(mockSignalSessionExpired).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
