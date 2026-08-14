/**
 * sidebarErrorBoundary.test.tsx
 *
 * Unit tests for the ErrorBoundary component as used in the sidebar context.
 * Validates SEED F-007: a render exception inside the sidebar subtree must
 * collapse to a contained fallback UI rather than blanking the whole app.
 *
 * Scenarios:
 *  1. A child that throws synchronously on mount causes the boundary to render
 *     its fallback UI rather than propagating the error to the parent.
 *  2. The fallback includes a user-readable message referencing the label prop.
 *  3. The "Try again" button resets the boundary so children can render again.
 *  4. A parent error boundary outside the tested boundary does NOT catch errors
 *     that the inner boundary already handled.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Suppress React's own console.error output for caught boundary errors.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A component that always throws during render. */
function AlwaysThrows({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

/** A component that renders normally — used as a control. */
function NeverThrows(): React.ReactElement {
  return <div data-testid="healthy-child">healthy</div>;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ErrorBoundary — sidebar context (SEED F-007)", () => {
  it("renders children when no error is thrown", () => {
    render(
      <ErrorBoundary label="the sidebar">
        <NeverThrows />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("healthy-child")).toBeTruthy();
    expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
  });

  it("shows the fallback UI when a child throws synchronously", () => {
    render(
      <ErrorBoundary label="the sidebar">
        <AlwaysThrows message="sidebar panel exploded" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback")).toBeTruthy();
  });

  it("fallback message references the label prop", () => {
    render(
      <ErrorBoundary label="the sidebar">
        <AlwaysThrows message="panel crash" />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("error-boundary-fallback").textContent).toContain(
      "the sidebar",
    );
  });

  it("does not propagate the error to the parent component", () => {
    // If the error escapes the boundary, the outer class component would
    // catch it and record it.
    class OuterCatcher extends React.Component<
      { children: React.ReactNode },
      { caught: string | null }
    > {
      override state = { caught: null };
      static getDerivedStateFromError(e: Error) {
        return { caught: e.message };
      }
      override render() {
        if (this.state.caught) {
          return (
            <div data-testid="outer-caught">{this.state.caught}</div>
          );
        }
        return this.props.children;
      }
    }

    render(
      <OuterCatcher>
        <ErrorBoundary label="the sidebar">
          <AlwaysThrows message="inner crash" />
        </ErrorBoundary>
      </OuterCatcher>,
    );

    // Inner boundary should have caught it — outer should NOT have fired.
    expect(screen.queryByTestId("outer-caught")).toBeNull();
    expect(screen.getByTestId("error-boundary-fallback")).toBeTruthy();
  });

  it("resets and re-renders children after the Try-again button is clicked", () => {
    let shouldThrow = true;

    function Conditional(): React.ReactElement {
      if (shouldThrow) throw new Error("conditional crash");
      return <div data-testid="recovered-child">recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary label="the sidebar">
        <Conditional />
      </ErrorBoundary>,
    );

    // Boundary should be in error state.
    expect(screen.getByTestId("error-boundary-fallback")).toBeTruthy();

    // Allow children to render without throwing.
    shouldThrow = false;

    // Click "Try again" to reset the boundary.
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Force a re-render so the reset propagates.
    rerender(
      <ErrorBoundary label="the sidebar">
        <Conditional />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId("recovered-child")).toBeTruthy();
    expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();
  });
});
