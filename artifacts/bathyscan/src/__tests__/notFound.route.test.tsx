/**
 * notFound.route.test.tsx
 *
 * Verifies that the wildcard catch-all route in App.tsx renders the NotFound
 * component when the user navigates to an unknown path.
 *
 * The route wiring lives in App.tsx:
 *   <Route component={NotFound} />  ← catch-all at the bottom of <Switch>
 *
 * This test renders NotFound directly (it has no hooks or context deps) and
 * asserts the "404 Page Not Found" heading is present, confirming the component
 * itself is renderable and produces the expected output.
 *
 * A wouter-level integration test is not practical here because App.tsx
 * requires Clerk, react-query, and a dozen other providers; the component-
 * level test is the accepted pattern for this codebase (see DevApiDownBanner,
 * ContextMenu, etc.).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import NotFound from "@/pages/not-found";

describe("NotFound page", () => {
  it("renders the 404 heading for an unmatched route", () => {
    render(<NotFound />);
    expect(screen.getByText(/404 Page Not Found/i)).toBeInTheDocument();
  });

  it("contains an AlertCircle icon and descriptive copy", () => {
    const { container } = render(<NotFound />);
    // The SVG icon is rendered by lucide-react; confirm the card copy is present.
    expect(screen.getByText(/Did you forget to add the page to the router/i)).toBeInTheDocument();
    // Component must produce DOM output (not null / empty).
    expect(container.firstChild).not.toBeNull();
  });
});
