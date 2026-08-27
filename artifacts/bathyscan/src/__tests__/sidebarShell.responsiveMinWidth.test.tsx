/**
 * Regression guard: sidebar shell components must use viewport-relative
 * minWidth values so they do not overflow viewports narrower than ~580 px.
 *
 * Covers:
 *   - SidebarSection (SHELL style) — wraps embedded DatasetPanel in the app
 *   - SidebarModeTabs (inline style on the tab row) — always-visible mode tabs
 *
 * Both were fixed from bare `minWidth: 460` to `min(460px, 100vw - 32px)`.
 * These tests render each component and confirm the style is viewport-relative,
 * preventing a future edit from silently reverting to a hardcoded pixel value.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SidebarSection, SidebarSectionGroup } from "@/components/SidebarSection";
import { usePanelCollapseStore, DEFAULTS } from "@/lib/panelCollapseStore";

// ---------------------------------------------------------------------------
// Minimal mocks for SidebarSection
// ---------------------------------------------------------------------------

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Minimal mocks for SidebarModeTabs (heavier deps — mocked away entirely)
// ---------------------------------------------------------------------------

vi.mock("@/lib/uiStore", () => {
  const mockState = { sidebarMode: "explore" as const };
  const useUiStore = Object.assign(
    (sel: (s: typeof mockState) => unknown) => sel(mockState),
    { getState: () => mockState },
  );
  return { useUiStore };
});

vi.mock("@/lib/context", () => ({
  useAppState: () => ({ terrain: null }),
}));

vi.mock("@/lib/driftStore", () => ({
  useDriftStore: (sel: (s: { active: boolean }) => unknown) =>
    sel({ active: false }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/settingsStore", () => {
  type S = { sidebarMode: "explore" };
  const state: S = { sidebarMode: "explore" };
  const useSettingsStore = Object.assign(
    (sel: (s: S) => unknown) => sel(state),
    {
      getState: () => state,
      persist: { hasHydrated: () => true },
      setState: () => {},
      subscribe: () => () => {},
    },
  );
  return { useSettingsStore };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk the DOM tree and return the first element whose inline minWidth is set. */
function findFirstMinWidth(root: Element): HTMLElement | null {
  const mw = (root as HTMLElement).style?.minWidth;
  if (mw && mw !== "0px" && mw !== "") return root as HTMLElement;
  for (const child of Array.from(root.children)) {
    const found = findFirstMinWidth(child);
    if (found) return found;
  }
  return null;
}

function assertViewportRelative(el: HTMLElement | null, label: string) {
  expect(el, `${label}: no element with a minWidth style was found`).not.toBeNull();
  if (el === null) return;
  const mw = el.style.minWidth;
  const ok = mw.includes("vw") || mw.includes("min(");
  expect(
    ok,
    `${label}: minWidth "${mw}" should contain vw or min() — bare pixel values overflow narrow viewports`,
  ).toBe(true);
}

function assertDesktopWidthAndViewportCap(size: string) {
  // CSSOM implementations either preserve the source expression or normalize
  // 520px + 2.25in to 736px (96 CSS px per inch).
  const hasDesktopWidth =
    size.includes("736px") ||
    (size.includes("520px") && size.includes("2.25in"));
  expect(hasDesktopWidth, `expected the 2.25-inch desktop width in "${size}"`).toBe(true);
  expect(size, `expected a viewport width cap in "${size}"`).toContain("100vw");
  expect(size, `expected a 32px viewport inset in "${size}"`).toMatch(/-32px/);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sidebar shell — responsive minWidth", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("SidebarSection (SHELL style) uses a viewport-relative minWidth", () => {
    const { container } = render(
      <SidebarSection id="habitat" title="Habitat">
        <div>panel content</div>
      </SidebarSection>,
    );
    const el = findFirstMinWidth(container);
    assertViewportRelative(el, "SidebarSection");
  });

  it("wide SidebarSectionGroup adds 2.25 CSS inches while staying viewport-safe", () => {
    const { getByTestId } = render(
      <SidebarSectionGroup wide testId="wide-library-shell">
        <SidebarSection id="mapData" title="Your Data">
          <div>library content</div>
        </SidebarSection>
      </SidebarSectionGroup>,
    );

    const shell = getByTestId("wide-library-shell");
    for (const size of [shell.style.width, shell.style.minWidth, shell.style.maxWidth]) {
      assertDesktopWidthAndViewportCap(size);
    }
  });

  it("SidebarModeTabs uses a viewport-relative minWidth", async () => {
    // Dynamically import so the mocks above are in place before module init.
    const { SidebarModeTabs } = await import("@/components/SidebarModeTabs");
    const { container } = render(<SidebarModeTabs />);
    const el = findFirstMinWidth(container);
    assertViewportRelative(el, "SidebarModeTabs");
  });
});
