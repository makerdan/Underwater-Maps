/**
 * Unit tests for ToolbarRelocationHint — the one-time dismissible notice
 * shown where the old top-right toolbar (Drive Boat / Tidal 3D / Drift)
 * used to live.
 *
 * Visibility matrix:
 *   • hasSeenOnboarding=false → hidden (new users learn locations from the tour)
 *   • hasSeenToolbarRelocationHint=true → hidden (already dismissed)
 *   • hasSeenOnboarding=true && hint not seen → visible
 * Dismissal fires setHasSeenToolbarRelocationHint(true).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { settingsState, setHasSeenHintSpy } = vi.hoisted(() => {
  const setHasSeenHintSpy = vi.fn();
  return {
    setHasSeenHintSpy,
    settingsState: {
      hasSeenOnboarding: true,
      hasSeenToolbarRelocationHint: false,
      setHasSeenToolbarRelocationHint: setHasSeenHintSpy,
    },
  };
});

vi.mock("@/lib/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (sel: (s: typeof settingsState) => unknown) => sel(settingsState),
    { getState: () => settingsState },
  ),
}));

import { ToolbarRelocationHint } from "@/components/ToolbarRelocationHint";

beforeEach(() => {
  setHasSeenHintSpy.mockClear();
  settingsState.hasSeenOnboarding = true;
  settingsState.hasSeenToolbarRelocationHint = false;
});

describe("ToolbarRelocationHint", () => {
  it("renders for returning users who have not dismissed it", () => {
    render(<ToolbarRelocationHint />);
    expect(screen.getByTestId("toolbar-relocation-hint")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-relocation-hint-dismiss")).toBeInTheDocument();
  });

  it("does not render before onboarding is complete", () => {
    settingsState.hasSeenOnboarding = false;
    render(<ToolbarRelocationHint />);
    expect(screen.queryByTestId("toolbar-relocation-hint")).toBeNull();
  });

  it("does not render once the hint has been dismissed", () => {
    settingsState.hasSeenToolbarRelocationHint = true;
    render(<ToolbarRelocationHint />);
    expect(screen.queryByTestId("toolbar-relocation-hint")).toBeNull();
  });

  it("persists dismissal via setHasSeenToolbarRelocationHint(true)", () => {
    render(<ToolbarRelocationHint />);
    fireEvent.click(screen.getByTestId("toolbar-relocation-hint-dismiss"));
    expect(setHasSeenHintSpy).toHaveBeenCalledWith(true);
  });
});
