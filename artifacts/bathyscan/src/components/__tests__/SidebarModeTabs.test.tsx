/**
 * Unit tests for SidebarModeTabs responsive variants:
 *   • Desktop (useIsMobile → false): text-only labels, no icons.
 *   • Mobile  (useIsMobile → true):  icon-only, no visible label text,
 *     accessible name preserved via aria-label.
 * Mode switching must fire in both variants, and the shared testids
 * (sidebar-mode-tabs, sidebar-mode-tab-<mode>) must remain stable.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockState, setSidebarModeSpy, isMobileRef } = vi.hoisted(() => {
  const setSidebarModeSpy = vi.fn();
  return {
    setSidebarModeSpy,
    mockState: {
      sidebarMode: "explore" as string,
      setSidebarMode: setSidebarModeSpy,
    },
    isMobileRef: { value: false },
  };
});

vi.mock("@/lib/uiStore", () => ({
  useUiStore: Object.assign(
    (sel: (s: typeof mockState) => unknown) => sel(mockState),
    { getState: () => mockState },
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobileRef.value,
}));

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { SidebarModeTabs } from "@/components/SidebarModeTabs";

const MODES = ["explore", "plan", "analyze", "live"] as const;
const LABELS = ["Explore", "Plan", "Analyze", "Live"] as const;

beforeEach(() => {
  setSidebarModeSpy.mockClear();
  mockState.sidebarMode = "explore";
  isMobileRef.value = false;
});

describe("SidebarModeTabs — desktop (text-only)", () => {
  it("renders all four text labels and no icons", () => {
    render(<SidebarModeTabs />);
    expect(screen.getByTestId("sidebar-mode-tabs")).toBeInTheDocument();
    for (const [i, mode] of MODES.entries()) {
      const btn = screen.getByTestId(`sidebar-mode-tab-${mode}`);
      expect(btn).toHaveTextContent(new RegExp(`^${LABELS[i]}$`, "i"));
      expect(btn.querySelector("svg")).toBeNull();
    }
  });

  it("highlights the active tab via aria-pressed", () => {
    mockState.sidebarMode = "plan";
    render(<SidebarModeTabs />);
    expect(screen.getByTestId("sidebar-mode-tab-plan")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sidebar-mode-tab-explore")).toHaveAttribute("aria-pressed", "false");
  });

  it("fires mode switching on click", () => {
    render(<SidebarModeTabs />);
    fireEvent.click(screen.getByTestId("sidebar-mode-tab-analyze"));
    expect(setSidebarModeSpy).toHaveBeenCalledWith("analyze");
  });
});

describe("SidebarModeTabs — mobile (icon-only)", () => {
  beforeEach(() => {
    isMobileRef.value = true;
  });

  it("renders an icon and no visible label text in each tab", () => {
    render(<SidebarModeTabs />);
    for (const mode of MODES) {
      const btn = screen.getByTestId(`sidebar-mode-tab-${mode}`);
      expect(btn.querySelector("svg")).not.toBeNull();
      expect(btn.textContent).toBe("");
    }
  });

  it("keeps an accessible name via aria-label", () => {
    render(<SidebarModeTabs />);
    for (const [i, mode] of MODES.entries()) {
      expect(screen.getByTestId(`sidebar-mode-tab-${mode}`)).toHaveAttribute(
        "aria-label",
        LABELS[i],
      );
    }
    expect(screen.getByRole("button", { name: "Live" })).toBeInTheDocument();
  });

  it("fires mode switching on tap/click", () => {
    render(<SidebarModeTabs />);
    fireEvent.click(screen.getByTestId("sidebar-mode-tab-live"));
    expect(setSidebarModeSpy).toHaveBeenCalledWith("live");
  });
});
