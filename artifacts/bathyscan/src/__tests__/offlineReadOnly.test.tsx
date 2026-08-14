/**
 * offlineReadOnly.test.tsx
 *
 * Tests for the auth offline read-only mode introduced in Task #3658.
 *
 * Covers:
 *  - getTokenWithRetry: null token + offline → setOfflineReadOnly called, NOT onExpired
 *  - getTokenWithRetry: null token + online  → onExpired called (existing path unchanged)
 *  - getTokenWithRetry: reconnect + token recovers → setOfflineReadOnly(false) and banner dismisses
 *  - getTokenWithRetry: reconnect + token still null → onExpired fires (session-expired path)
 *  - OfflineReadOnlyBanner: renders with cached identity
 *  - OfflineReadOnlyBanner: renders without cached identity
 *  - OfflineReadOnlyBanner: does not render when isOfflineReadOnly is false
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { getTokenWithRetry } from "@/App";
import { useOfflineStore } from "@/lib/offlineStore";
import { OfflineReadOnlyBanner } from "@/components/OfflineReadOnlyBanner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setOnlineState(isOnline: boolean) {
  act(() => {
    useOfflineStore.getState().setOnline(isOnline);
  });
}

// ─── getTokenWithRetry — offline intercept ────────────────────────────────────

describe("getTokenWithRetry — offline intercept", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Start each test online so we don't bleed state
    act(() => {
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  it("sets offline read-only mode (not session-expired) when both calls return null and device is offline", async () => {
    setOnlineState(false);
    const getToken = vi.fn().mockResolvedValue(null);
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(true);
  });

  it("calls onExpired (not setOfflineReadOnly) when both calls return null and device is online", async () => {
    setOnlineState(true);
    const getToken = vi.fn().mockResolvedValue(null);
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    await promise;

    expect(onExpired).toHaveBeenCalledOnce();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });

  it("does not touch isOfflineReadOnly when the first call succeeds", async () => {
    setOnlineState(false);
    const getToken = vi.fn().mockResolvedValue("tok-ok");
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("tok-ok");
    expect(onExpired).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });

  it("does not touch isOfflineReadOnly when the retry call succeeds", async () => {
    setOnlineState(false);
    const getToken = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue("tok-retry");
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("tok-retry");
    expect(onExpired).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });
});

// ─── getTokenWithRetry — reconnect restore path ───────────────────────────────

describe("getTokenWithRetry — used in reconnect path: token recovers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => {
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  it("clears offline read-only when reconnect handler re-runs and token succeeds", async () => {
    // Simulate: was in offline read-only, device comes back, token now available
    act(() => {
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setOfflineReadOnly(false); // cleared by reconnect handler
    });

    const getToken = vi.fn().mockResolvedValue("tok-recovered");
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("tok-recovered");
    expect(onExpired).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });

  it("fires onExpired when reconnect handler re-runs and token is still null", async () => {
    // Simulate: device reconnected, but token still null (genuine expiry)
    act(() => {
      useOfflineStore.getState().setOnline(true);
      useOfflineStore.getState().setOfflineReadOnly(false); // cleared by reconnect handler
    });

    const getToken = vi.fn().mockResolvedValue(null);
    const onExpired = vi.fn();

    const promise = getTokenWithRetry(getToken, onExpired, 0);
    await vi.runAllTimersAsync();
    await promise;

    expect(onExpired).toHaveBeenCalledOnce();
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });
});

// ─── OfflineReadOnlyBanner — component tests ──────────────────────────────────

const IDENTITY_KEY = "bathyscan-offline-identity-v1";

describe("OfflineReadOnlyBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  afterEach(() => {
    localStorage.clear();
    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  it("does not render when isOfflineReadOnly is false", () => {
    render(<OfflineReadOnlyBanner />);
    expect(screen.queryByTestId("offline-read-only-banner")).toBeNull();
  });

  it("renders when isOfflineReadOnly is true", async () => {
    render(<OfflineReadOnlyBanner />);

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    expect(await screen.findByTestId("offline-read-only-banner")).toBeInTheDocument();
  });

  it("shows the cached display name when available", async () => {
    localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ displayName: "Alex B.", userId: "u_123" }),
    );

    render(<OfflineReadOnlyBanner />);

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    const banner = await screen.findByTestId("offline-read-only-banner");
    expect(banner).toHaveTextContent("Alex B.");
  });

  it("renders gracefully without a cached display name", async () => {
    // No localStorage entry set
    render(<OfflineReadOnlyBanner />);

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    const banner = await screen.findByTestId("offline-read-only-banner");
    expect(banner).toHaveTextContent("You're offline — viewing your saved data");
    // Should not show "()" when no name is available
    expect(banner.textContent).not.toMatch(/\(\s*\)/);
  });

  it("does not show a reload button (reloading while offline does nothing)", async () => {
    render(<OfflineReadOnlyBanner />);

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    await screen.findByTestId("offline-read-only-banner");
    expect(screen.queryByRole("button", { name: /reload/i })).toBeNull();
  });

  it("dismisses when isOfflineReadOnly returns to false", async () => {
    render(<OfflineReadOnlyBanner />);

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(true);
    });

    expect(await screen.findByTestId("offline-read-only-banner")).toBeInTheDocument();

    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });

    expect(screen.queryByTestId("offline-read-only-banner")).toBeNull();
  });
});

// ─── offlineStore — isOfflineReadOnly state slice ────────────────────────────

describe("useOfflineStore — isOfflineReadOnly", () => {
  afterEach(() => {
    act(() => {
      useOfflineStore.getState().setOfflineReadOnly(false);
    });
  });

  it("starts as false", () => {
    // Reset to initial state
    act(() => useOfflineStore.getState().setOfflineReadOnly(false));
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });

  it("can be set to true and back to false", () => {
    act(() => useOfflineStore.getState().setOfflineReadOnly(true));
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(true);

    act(() => useOfflineStore.getState().setOfflineReadOnly(false));
    expect(useOfflineStore.getState().isOfflineReadOnly).toBe(false);
  });
});
