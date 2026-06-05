/**
 * Unit tests for queryClient.ts — retry policy, toast suppression, the
 * _isConnecting server-warming flag, and the useIsConnecting reactive hook.
 *
 * Covers:
 *  - retry(failureCount, error) returns true for 502 up to 5 attempts
 *  - retry(failureCount, error) returns false for 502 at failureCount 5
 *  - retry(failureCount, error) returns true for non-502 up to 2 attempts
 *  - retry(failureCount, error) returns false for non-502 at failureCount 2
 *  - QueryCache onError suppresses toast for 401
 *  - QueryCache onError suppresses toast for 502 (server still warming up)
 *  - QueryCache onError fires a destructive toast for all other errors
 *  - QueryCache onSuccess resets _isConnecting to false
 *  - MutationCache onError follows the same suppression rules
 *  - useIsConnecting starts false, reacts to 502 errors, resets after success
 *  - useIsConnecting reacts to TypeError network errors ("Failed to fetch", "Load failed")
 *  - network TypeError errors do not fire a toast
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Stable toast spy ──────────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so the spy must also
// be declared with vi.hoisted() to avoid "Cannot access before initialization".
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

// Import after the mock is registered (vi.mock is hoisted, so this is safe).
import { queryClient, useIsConnecting } from "@/lib/queryClient";

// ── Cache config helpers ──────────────────────────────────────────────────────

// Access the onError / onSuccess callbacks registered on the caches directly
// so we can drive them in tests without spinning up real network requests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const qcConfig = (queryClient.getQueryCache() as any).config as {
  onError?: (error: unknown, query: unknown) => void;
  onSuccess?: (data: unknown, query: unknown) => void;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mcConfig = (queryClient.getMutationCache() as any).config as {
  onError?: (error: unknown, mutation: unknown) => void;
};

function triggerQueryError(error: unknown) {
  qcConfig.onError?.(error, {});
}

function triggerQuerySuccess() {
  qcConfig.onSuccess?.(undefined, {});
}

function triggerMutationError(error: unknown) {
  mcConfig.onError?.(error, {});
}

/** Call the retry function from the default query options. */
function callRetry(failureCount: number, error: unknown): boolean {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") throw new Error("retry is not a function");
  return retry(failureCount, error);
}

function makeStatusError(status: number, message = "error"): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

// ── Reset shared module state between tests ───────────────────────────────────
// _isConnecting is module-level mutable state; drive it back to false via the
// public onSuccess path so each test starts from a clean baseline.
beforeEach(() => {
  mockToast.mockReset();
  triggerQuerySuccess();
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy — 502 errors (limit: 5)
// ─────────────────────────────────────────────────────────────────────────────

describe("queryClient retry policy — 502 errors (limit 5)", () => {
  const err502 = makeStatusError(502);

  it("retries on the 1st failure (failureCount 0)", () => {
    expect(callRetry(0, err502)).toBe(true);
  });

  it("retries on the 2nd failure (failureCount 1)", () => {
    expect(callRetry(1, err502)).toBe(true);
  });

  it("retries on the 3rd failure (failureCount 2)", () => {
    expect(callRetry(2, err502)).toBe(true);
  });

  it("retries on the 4th failure (failureCount 3)", () => {
    expect(callRetry(3, err502)).toBe(true);
  });

  it("retries on the 5th failure (failureCount 4)", () => {
    expect(callRetry(4, err502)).toBe(true);
  });

  it("stops retrying after 5 attempts (failureCount 5)", () => {
    expect(callRetry(5, err502)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry policy — non-502 errors (limit: 2)
// ─────────────────────────────────────────────────────────────────────────────

describe("queryClient retry policy — non-502 errors (limit 2)", () => {
  it("retries on the 1st failure for a 500 (failureCount 0)", () => {
    expect(callRetry(0, makeStatusError(500))).toBe(true);
  });

  it("retries on the 2nd failure for a 500 (failureCount 1)", () => {
    expect(callRetry(1, makeStatusError(500))).toBe(true);
  });

  it("stops after 2 attempts for a 500 (failureCount 2)", () => {
    expect(callRetry(2, makeStatusError(500))).toBe(false);
  });

  it("applies the 2-retry cap to plain Error objects (failureCount 2)", () => {
    expect(callRetry(2, new Error("network failure"))).toBe(false);
  });

  it("applies the 2-retry cap to non-object errors (failureCount 2)", () => {
    expect(callRetry(2, "string-error")).toBe(false);
  });

  it("applies the 2-retry cap to 401 errors (failureCount 2)", () => {
    expect(callRetry(2, makeStatusError(401))).toBe(false);
  });

  it("502 receives more retries than 500 at the same failure count (4)", () => {
    expect(callRetry(4, makeStatusError(502))).toBe(true);
    expect(callRetry(4, makeStatusError(500))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QueryCache onError — toast suppression
// ─────────────────────────────────────────────────────────────────────────────

describe("queryClient QueryCache onError — 401 suppression", () => {
  it("does NOT fire a toast for 401 object errors", () => {
    triggerQueryError({ status: 401, message: "Unauthorized" });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does NOT fire a toast for 401 Error instances", () => {
    triggerQueryError(makeStatusError(401, "Unauthorized"));
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("queryClient QueryCache onError — 502 suppression", () => {
  it("does NOT fire a toast for 502 object errors", () => {
    triggerQueryError({ status: 502 });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does NOT fire a toast for 502 Error instances", () => {
    triggerQueryError(makeStatusError(502, "Bad Gateway"));
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe("queryClient QueryCache onError — destructive toast for other errors", () => {
  it("fires a destructive toast for plain Error objects (no status field)", () => {
    triggerQueryError(new Error("Network failure"));
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Request failed",
        description: "Network failure",
        variant: "destructive",
      }),
    );
  });

  it("fires a destructive toast for 500 errors", () => {
    triggerQueryError(makeStatusError(500, "Internal Server Error"));
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("fires a destructive toast for 403 errors (not suppressed)", () => {
    triggerQueryError({ status: 403, message: "Forbidden" });
    expect(mockToast).toHaveBeenCalledOnce();
  });

  it("falls back to a generic description when the thrown value is not an Error instance", () => {
    triggerQueryError("something bad happened");
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "An unexpected error occurred.",
        variant: "destructive",
      }),
    );
  });

  it("includes the error message from an Error instance in the toast description", () => {
    triggerQueryError(Object.assign(new Error("Something broke"), { status: 503 }));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Something broke" }),
    );
  });

  it("fires one toast per distinct non-suppressed error", () => {
    triggerQueryError(new Error("first"));
    triggerQueryError(new Error("second"));
    expect(mockToast).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MutationCache onError — toast suppression (same rules as QueryCache)
// ─────────────────────────────────────────────────────────────────────────────

describe("queryClient MutationCache onError — toast suppression", () => {
  it("does NOT fire a toast for 401 mutation errors", () => {
    triggerMutationError({ status: 401, message: "Unauthorized" });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does NOT fire a toast for 502 mutation errors", () => {
    triggerMutationError(makeStatusError(502, "Bad Gateway"));
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("fires a destructive toast for plain Error mutation failures", () => {
    triggerMutationError(new Error("Mutation error"));
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Request failed",
        description: "Mutation error",
        variant: "destructive",
      }),
    );
  });

  it("fires a destructive toast for 500 mutation errors", () => {
    triggerMutationError(makeStatusError(500, "mutation failed"));
    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// useIsConnecting reactive hook
// ─────────────────────────────────────────────────────────────────────────────

describe("useIsConnecting hook", () => {
  it("returns false initially (no 502 has occurred yet)", () => {
    const { result } = renderHook(() => useIsConnecting());
    expect(result.current).toBe(false);
  });

  it("returns true after a 502 query error", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(makeStatusError(502));
    });

    expect(result.current).toBe(true);
  });

  it("resets to false when a subsequent query succeeds", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(makeStatusError(502));
    });
    expect(result.current).toBe(true);

    act(() => {
      triggerQuerySuccess();
    });
    expect(result.current).toBe(false);
  });

  it("stays false when only non-502 errors occur", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(makeStatusError(500));
      triggerQueryError(makeStatusError(401));
      triggerQueryError(new Error("network timeout"));
    });

    expect(result.current).toBe(false);
  });

  it("stays true across multiple 502s until a success clears it", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(makeStatusError(502));
      triggerQueryError(makeStatusError(502));
      triggerQueryError(makeStatusError(502));
    });
    expect(result.current).toBe(true);

    act(() => {
      triggerQuerySuccess();
    });
    expect(result.current).toBe(false);
  });

  it("can cycle between true and false across multiple 502/success pairs", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => { triggerQueryError(makeStatusError(502)); });
    expect(result.current).toBe(true);

    act(() => { triggerQuerySuccess(); });
    expect(result.current).toBe(false);

    act(() => { triggerQueryError(makeStatusError(502)); });
    expect(result.current).toBe(true);

    act(() => { triggerQuerySuccess(); });
    expect(result.current).toBe(false);
  });

  it("remains true (no extra re-render) when a second 502 arrives while already true", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => { triggerQueryError(makeStatusError(502)); });
    expect(result.current).toBe(true);

    // A second 502 should keep the value at true (setIsConnecting guards same-value writes).
    act(() => { triggerQueryError(makeStatusError(502)); });
    expect(result.current).toBe(true);
  });

  it('returns true after a TypeError("Failed to fetch") network error', () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new TypeError("Failed to fetch"));
    });

    expect(result.current).toBe(true);
  });

  it('returns true after a TypeError("Load failed") network error', () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new TypeError("Load failed"));
    });

    expect(result.current).toBe(true);
  });

  it("does NOT fire a toast for a TypeError network error", () => {
    renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new TypeError("Failed to fetch"));
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("resets to false when a query succeeds after a TypeError network error", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new TypeError("Failed to fetch"));
    });
    expect(result.current).toBe(true);

    act(() => {
      triggerQuerySuccess();
    });
    expect(result.current).toBe(false);
  });

  it("does NOT fire a toast for a TypeError('Load failed') network error", () => {
    renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new TypeError("Load failed"));
    });

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("stays false when a plain Error (not TypeError) with 'network' in the message occurs", () => {
    const { result } = renderHook(() => useIsConnecting());

    act(() => {
      triggerQueryError(new Error("Failed to fetch"));
    });

    expect(result.current).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Interaction: connecting flag does not interfere with other-error toast
// ─────────────────────────────────────────────────────────────────────────────

describe("_isConnecting flag — interaction with other error toasts", () => {
  it("a 502 followed by a 500 still fires a toast for the 500", () => {
    triggerQueryError(makeStatusError(502)); // suppressed, sets _isConnecting
    mockToast.mockClear();

    triggerQueryError(makeStatusError(500, "real server error"));

    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
