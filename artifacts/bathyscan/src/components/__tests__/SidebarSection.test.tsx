import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ViewscreenTooltip", () => ({
  ViewscreenTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SidebarSection, SidebarSectionGroup } from "@/components/SidebarSection";
import { DEFAULTS, usePanelCollapseStore } from "@/lib/panelCollapseStore";

function PlanTools() {
  return (
    <SidebarSectionGroup testId="plan-tools-test">
      <SidebarSection id="tripWindows" title="Trip Windows"><div>trip content</div></SidebarSection>
      <SidebarSection id="conditions" title="Conditions"><div>conditions content</div></SidebarSection>
      <SidebarSection id="forecast" title="Forecast"><div>forecast content</div></SidebarSection>
      <SidebarSection id="routes" title="Routes"><div>routes content</div></SidebarSection>
      <SidebarSection id="driftRoute" title="Drift & Route"><div>drift content</div></SidebarSection>
    </SidebarSectionGroup>
  );
}

describe("Plan tool sections", () => {
  beforeEach(() => {
    localStorage.clear();
    usePanelCollapseStore.setState({ collapsed: { ...DEFAULTS } });
  });

  it("renders the five tools in the requested order, collapsed by default", () => {
    render(<PlanTools />);
    const headers = screen.getAllByRole("button");
    expect(headers.map((button) => button.textContent?.trim())).toEqual([
      "▸Trip Windows",
      "▸Conditions",
      "▸Forecast",
      "▸Routes",
      "▸Drift & Route",
    ]);
    expect(screen.queryByText("trip content")).not.toBeInTheDocument();
    expect(screen.queryByText("conditions content")).not.toBeInTheDocument();
    expect(screen.queryByText("forecast content")).not.toBeInTheDocument();
    expect(screen.queryByText("routes content")).not.toBeInTheDocument();
    expect(screen.queryByText("drift content")).not.toBeInTheDocument();
  });

  it("expands only the selected tool and gives every header the same treatment", () => {
    render(<PlanTools />);
    const headers = screen.getAllByRole("button");
    const headerStyle = headers[0]?.getAttribute("style");
    expect(headerStyle).toBeTruthy();
    for (const header of headers) {
      expect(header).toHaveAttribute("aria-expanded", "false");
      expect(header.getAttribute("style")).toBe(headerStyle);
    }

    fireEvent.click(screen.getByRole("button", { name: /Trip Windows/i }));
    expect(screen.getByText("trip content")).toBeInTheDocument();
    expect(screen.queryByText("conditions content")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trip Windows/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Conditions/i })).toHaveAttribute("aria-expanded", "false");
  });
});