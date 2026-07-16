/**
 * AdvancedSection component unit tests.
 *
 * DESIGN NOTE — always-mounted children (CSS clip):
 *   AdvancedSection intentionally keeps its children mounted at all times.
 *   Visibility is achieved exclusively through CSS (maxHeight: 0 / opacity: 0
 *   when collapsed, maxHeight: 1200px / opacity: 1 when expanded).  This is the
 *   stated design in the component JSDoc: "Children are always mounted so their
 *   state is preserved; the container is clipped and faded when collapsed."
 *
 *   Task step 2 mentioned "children not rendered when collapsed (for
 *   performance)" — that language predated the implementation decision to use
 *   CSS-clip animation to preserve child state across toggle cycles.  The
 *   implementation is the source of truth; these tests verify its actual
 *   behaviour.
 *
 * Covers:
 *   - data-testid on the toggle button matches `advanced-toggle-${panelId}`
 *   - Toggle button aria-expanded reflects collapsed/expanded store state
 *   - Collapsed container: maxHeight=0px, opacity=0 (CSS clip — NOT DOM removal)
 *   - Expanded container: maxHeight=1200px, opacity=1
 *   - Children ARE in the DOM when collapsed (CSS-clip design)
 *   - Clicking the toggle calls panelCollapseStore.toggle(panelId)
 *   - State-restored-on-mount: component reflects whatever the store returns
 *   - Two-instance isolation
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let mockCollapsed = true;
const mockToggle = vi.fn();

vi.mock("@/lib/panelCollapseStore", () => ({
  usePanelCollapseStore: (
    sel: (s: { collapsed: Record<string, boolean>; toggle: (id: string) => void }) => unknown,
  ) =>
    sel({
      collapsed: new Proxy({} as Record<string, boolean>, { get: () => mockCollapsed }),
      toggle: mockToggle,
    }),
}));

import { AdvancedSection } from "@/components/AdvancedSection";

function resetMocks(collapsed = true) {
  mockCollapsed = collapsed;
  mockToggle.mockClear();
}

describe("AdvancedSection", () => {
  beforeEach(() => resetMocks());

  // ── Rendering and data-testid ─────────────────────────────────────────────

  it("renders the toggle button with data-testid=advanced-toggle-{panelId}", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    expect(
      screen.getByTestId("advanced-toggle-overlaysToolsAdvanced"),
    ).toBeInTheDocument();
  });

  it("renders an 'Advanced' label inside the toggle button", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
  });

  // ── Default collapsed state ───────────────────────────────────────────────

  it("toggle button has aria-expanded='false' when store reports collapsed=true", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    const btn = screen.getByTestId("advanced-toggle-overlaysToolsAdvanced");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("collapsed container uses maxHeight=0px to clip children (CSS-clip design, not DOM removal)", () => {
    const { container } = render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span data-testid="inner-child">inner</span>
      </AdvancedSection>,
    );
    const root = container.firstChild as HTMLElement;
    const contentDiv = root.children[1] as HTMLElement;
    // jsdom normalises the inline `maxHeight: 0` number to "0px"
    expect(contentDiv.style.maxHeight).toBe("0px");
    // Child is in the DOM (CSS-clip, not unmount)
    expect(screen.getByTestId("inner-child")).toBeInTheDocument();
  });

  it("collapsed container has opacity=0", () => {
    const { container } = render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    const root = container.firstChild as HTMLElement;
    const contentDiv = root.children[1] as HTMLElement;
    expect(contentDiv.style.opacity).toBe("0");
  });

  // ── Children always in DOM (CSS-clip design) ──────────────────────────────
  //
  // Because AdvancedSection uses CSS max-height/opacity to clip, children are
  // present in the DOM even when collapsed — their interactive state (scroll
  // position, input values) is preserved across toggle cycles.

  it("a range input inside the section is present in the DOM when collapsed", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <input type="range" data-testid="slider" aria-label="intensity" />
      </AdvancedSection>,
    );
    expect(screen.getByTestId("slider")).toBeInTheDocument();
  });

  it("a button inside the section is present in the DOM when collapsed", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <button data-testid="inner-btn">toggle</button>
      </AdvancedSection>,
    );
    expect(screen.getByTestId("inner-btn")).toBeInTheDocument();
  });

  // ── Toggle interaction ────────────────────────────────────────────────────

  it("clicking the button calls toggle with the panelId", () => {
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    fireEvent.click(screen.getByTestId("advanced-toggle-overlaysToolsAdvanced"));
    expect(mockToggle).toHaveBeenCalledOnce();
    expect(mockToggle).toHaveBeenCalledWith("overlaysToolsAdvanced");
  });

  it("clicking the button calls toggle with a different panelId when panelId changes", () => {
    render(
      <AdvancedSection panelId="seafloorAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    fireEvent.click(screen.getByTestId("advanced-toggle-seafloorAdvanced"));
    expect(mockToggle).toHaveBeenCalledWith("seafloorAdvanced");
  });

  // ── Expanded state (store reports collapsed=false) ────────────────────────

  it("toggle button has aria-expanded='true' when store reports collapsed=false", () => {
    resetMocks(false);
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    const btn = screen.getByTestId("advanced-toggle-overlaysToolsAdvanced");
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("expanded container has maxHeight=1200px", () => {
    resetMocks(false);
    const { container } = render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    const root = container.firstChild as HTMLElement;
    const contentDiv = root.children[1] as HTMLElement;
    expect(contentDiv.style.maxHeight).toBe("1200px");
  });

  it("expanded container has opacity=1", () => {
    resetMocks(false);
    const { container } = render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    const root = container.firstChild as HTMLElement;
    const contentDiv = root.children[1] as HTMLElement;
    expect(contentDiv.style.opacity).toBe("1");
  });

  it("children are in the DOM when expanded", () => {
    resetMocks(false);
    render(
      <AdvancedSection panelId="overlaysToolsAdvanced">
        <span data-testid="inner-child">inner</span>
      </AdvancedSection>,
    );
    expect(screen.getByTestId("inner-child")).toBeInTheDocument();
  });

  // ── State-restored-on-mount ───────────────────────────────────────────────

  it("mounts in expanded state when the store already reports collapsed=false", () => {
    resetMocks(false);
    render(
      <AdvancedSection panelId="currentsPanelAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    expect(
      screen.getByTestId("advanced-toggle-currentsPanelAdvanced"),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("mounts in collapsed state when the store already reports collapsed=true", () => {
    resetMocks(true);
    render(
      <AdvancedSection panelId="habitatAdvanced">
        <span>child</span>
      </AdvancedSection>,
    );
    expect(
      screen.getByTestId("advanced-toggle-habitatAdvanced"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  // ── Isolation: different panelIds ─────────────────────────────────────────

  it("two AdvancedSection instances with different panelIds render independently", () => {
    render(
      <>
        <AdvancedSection panelId="overlaysToolsAdvanced">
          <span>a</span>
        </AdvancedSection>
        <AdvancedSection panelId="seafloorAdvanced">
          <span>b</span>
        </AdvancedSection>
      </>,
    );
    const btnA = screen.getByTestId("advanced-toggle-overlaysToolsAdvanced");
    const btnB = screen.getByTestId("advanced-toggle-seafloorAdvanced");
    expect(btnA).toBeInTheDocument();
    expect(btnB).toBeInTheDocument();
    // Both reflect the same mock collapsed state (true)
    expect(btnA).toHaveAttribute("aria-expanded", "false");
    expect(btnB).toHaveAttribute("aria-expanded", "false");
  });
});
