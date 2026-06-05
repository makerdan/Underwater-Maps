/**
 * clerkLoadErrorBoundary.test.tsx
 *
 * Unit tests for the ClerkLoadErrorBoundary React error boundary in App.tsx.
 *
 * Scenarios:
 *  1. When children throw immediately the boundary shows a "Connecting…"
 *     retrying state (not the final fallback).
 *  2. After all retry delays elapse and children keep throwing, the boundary
 *     renders the final fallback UI with a "Reload page" button.
 *  3. When children stop throwing after a retry the boundary clears and
 *     renders the children successfully.
 *  4. The error boundary's "Connecting…" status has role="status"; the
 *     final fallback has role="alert".
 *
 * React logs errors caught by error boundaries to the console; this is
 * suppressed via a console.error spy so test output stays clean.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import {
  ClerkLoadErrorBoundary,
  ClerkLoadFailedFallback,
  isClerkLoadError,
  MAX_CLERK_LOAD_RETRIES,
  CLERK_RETRY_DELAYS_MS,
} from "@/App";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleErrorSpy.mockRestore();
});

// ─── Simple parent boundary — catches whatever ClerkLoadErrorBoundary rethrows ──
interface SimpleBoundaryState { error: string | null }
class SimpleBoundary extends React.Component<{ children: React.ReactNode }, SimpleBoundaryState> {
  state: SimpleBoundaryState = { error: null };
  static getDerivedStateFromError(e: Error): SimpleBoundaryState {
    return { error: e.message };
  }
  render() {
    if (this.state.error) return <div data-testid="parent-caught">{this.state.error}</div>;
    return this.props.children;
  }
}

function AlwaysThrows(): never {
  throw new Error("failed_to_load_clerk_js");
}

let _shouldThrow = true;
function ThrowUntilReset() {
  if (_shouldThrow) throw new Error("failed_to_load_clerk_js");
  return <div data-testid="clerk-loaded">Clerk loaded</div>;
}

describe("ClerkLoadFailedFallback", () => {
  it("renders a reload button", () => {
    render(<ClerkLoadFailedFallback />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reload page")).toBeTruthy();
  });
});

describe("ClerkLoadErrorBoundary — retrying state", () => {
  it("renders a status region when children first throw", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <AlwaysThrows />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});

    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("does not show the final alert fallback before retries are exhausted", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <AlwaysThrows />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ClerkLoadErrorBoundary — exhausted retries", () => {
  it("shows the final fallback with a Reload page button after all retries fail", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <AlwaysThrows />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});

    for (let i = 0; i < MAX_CLERK_LOAD_RETRIES; i++) {
      const delay = CLERK_RETRY_DELAYS_MS[i] ?? 8_000;
      await act(async () => {
        vi.advanceTimersByTime(delay);
      });
      await act(async () => {});
    }

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Reload page")).toBeTruthy();
  });

  it("final fallback has correct text about authentication failure", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <AlwaysThrows />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});

    for (let i = 0; i < MAX_CLERK_LOAD_RETRIES; i++) {
      const delay = CLERK_RETRY_DELAYS_MS[i] ?? 8_000;
      await act(async () => { vi.advanceTimersByTime(delay); });
      await act(async () => {});
    }

    expect(screen.getByText(/Authentication service failed to load/i)).toBeTruthy();
  });
});

describe("ClerkLoadErrorBoundary — successful retry", () => {
  beforeEach(() => { _shouldThrow = true; });

  it("renders children once they stop throwing", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <ThrowUntilReset />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});
    expect(screen.queryByTestId("clerk-loaded")).toBeNull();

    _shouldThrow = false;

    await act(async () => {
      vi.advanceTimersByTime(CLERK_RETRY_DELAYS_MS[0]);
    });
    await act(async () => {});

    expect(screen.getByTestId("clerk-loaded")).toBeTruthy();
  });

  it("does not show the final fallback when a retry succeeds", async () => {
    render(
      <ClerkLoadErrorBoundary>
        <ThrowUntilReset />
      </ClerkLoadErrorBoundary>,
    );

    await act(async () => {});

    _shouldThrow = false;

    await act(async () => {
      vi.advanceTimersByTime(CLERK_RETRY_DELAYS_MS[0]);
    });
    await act(async () => {});

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ─── Non-Clerk errors must NOT be absorbed by this boundary ──────────────────

describe("ClerkLoadErrorBoundary — non-Clerk errors pass through to parent", () => {
  function ThrowsGenericError(): never {
    throw new Error("Something unrelated to Clerk exploded");
  }

  it("does not show Clerk Connecting status for a non-Clerk error", async () => {
    render(
      <SimpleBoundary>
        <ClerkLoadErrorBoundary>
          <ThrowsGenericError />
        </ClerkLoadErrorBoundary>
      </SimpleBoundary>,
    );

    await act(async () => {});

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not show ClerkLoadFailedFallback (alert) for a non-Clerk error", async () => {
    render(
      <SimpleBoundary>
        <ClerkLoadErrorBoundary>
          <ThrowsGenericError />
        </ClerkLoadErrorBoundary>
      </SimpleBoundary>,
    );

    await act(async () => {});

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets the parent boundary catch the non-Clerk error", async () => {
    render(
      <SimpleBoundary>
        <ClerkLoadErrorBoundary>
          <ThrowsGenericError />
        </ClerkLoadErrorBoundary>
      </SimpleBoundary>,
    );

    await act(async () => {});

    expect(screen.getByTestId("parent-caught")).toBeTruthy();
    expect(screen.getByTestId("parent-caught").textContent).toContain(
      "Something unrelated to Clerk exploded",
    );
  });
});

// ─── isClerkLoadError predicate ──────────────────────────────────────────────

describe("isClerkLoadError", () => {
  it("returns true for the canonical Clerk CDN error string", () => {
    expect(isClerkLoadError(new Error("failed_to_load_clerk_js"))).toBe(true);
  });

  it("returns true for the older Clerk SDK message variant", () => {
    expect(isClerkLoadError(new Error("ClerkJS could not be loaded"))).toBe(true);
  });

  it("returns true for the 'Failed to load Clerk' variant", () => {
    expect(isClerkLoadError(new Error("Failed to load Clerk from cdn"))).toBe(true);
  });

  it("returns false for an unrelated render error", () => {
    expect(isClerkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("returns false for a non-Error value", () => {
    expect(isClerkLoadError("failed_to_load_clerk_js")).toBe(false);
    expect(isClerkLoadError(null)).toBe(false);
    expect(isClerkLoadError(42)).toBe(false);
  });
});
