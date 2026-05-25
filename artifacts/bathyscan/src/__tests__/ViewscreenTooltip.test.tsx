/**
 * ViewscreenTooltip — gates the shadcn Tooltip on the `showUiTooltips`
 * user preference. When off, children pass through with no wrapping.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ViewscreenTooltip } from "@/components/ViewscreenTooltip";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

function resetStore() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
}

describe("ViewscreenTooltip", () => {
  beforeEach(() => resetStore());

  it("renders the child unchanged when showUiTooltips is OFF (no wrapper, no Radix attrs)", () => {
    useSettingsStore.getState().setShowUiTooltips(false);
    render(
      <TooltipProvider>
        <ViewscreenTooltip label="Hidden">
          <button data-testid="t-btn">CLICK</button>
        </ViewscreenTooltip>
      </TooltipProvider>,
    );
    const btn = screen.getByTestId("t-btn");
    expect(btn).toBeInTheDocument();
    // Radix Tooltip wraps the trigger with data-state attributes — verify absent.
    expect(btn.getAttribute("data-state")).toBeNull();
  });

  it("wraps children with a Radix tooltip trigger when showUiTooltips is ON", () => {
    useSettingsStore.getState().setShowUiTooltips(true);
    render(
      <TooltipProvider>
        <ViewscreenTooltip label="Visible hint">
          <button data-testid="t-btn">CLICK</button>
        </ViewscreenTooltip>
      </TooltipProvider>,
    );
    const btn = screen.getByTestId("t-btn");
    // Radix decorates the trigger element with data-state when wired up.
    expect(btn.getAttribute("data-state")).not.toBeNull();
  });

  it("passes through child even when ON if label is empty/null", () => {
    useSettingsStore.getState().setShowUiTooltips(true);
    render(
      <TooltipProvider>
        <ViewscreenTooltip label="">
          <button data-testid="t-btn">CLICK</button>
        </ViewscreenTooltip>
      </TooltipProvider>,
    );
    expect(screen.getByTestId("t-btn").getAttribute("data-state")).toBeNull();
  });
});
