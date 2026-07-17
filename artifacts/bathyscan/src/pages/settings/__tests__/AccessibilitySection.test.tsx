/**
 * AccessibilitySection unit tests.
 *
 * Covers:
 *   - Renders without crashing
 *   - Key toggles are present (Reduce Motion, Color-Blind Safe Palette, High-Contrast HUD, Bright Daylight)
 *   - Text Size select is present
 *   - Save and reset buttons (SectionActionsRow section="accessibility") are present
 *   - Clicking reset calls resetSection("accessibility")
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => {
  const resetSection = vi.fn();
  const setReducedMotion = vi.fn();
  const setColorBlindSafePalette = vi.fn();
  return { resetSection, setReducedMotion, setColorBlindSafePalette };
});

vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settingsStore")>();

  const state = () => ({
    reducedMotion: false,
    setReducedMotion: h.setReducedMotion,
    colorBlindSafePalette: false,
    setColorBlindSafePalette: h.setColorBlindSafePalette,
    globalFontSize: "medium" as const,
    setGlobalFontSize: vi.fn(),
    highContrastHud: false,
    setHighContrastHud: vi.fn(),
    brightDaylight: false,
    setBrightDaylight: vi.fn(),
    syncedSnapshot: null,
    lastSyncedAt: null,
    resetSection: h.resetSection,
  });

  const useSettingsStore = Object.assign(
    <T,>(sel: (s: ReturnType<typeof state>) => T): T => sel(state()),
    {
      getState: () => state(),
      setState: vi.fn(),
      persist: { hasHydrated: () => true, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );

  return { ...actual, useSettingsStore };
});

import { AccessibilitySection } from "../AccessibilitySection";

describe("AccessibilitySection", () => {
  beforeEach(() => {
    h.resetSection.mockClear();
    h.setReducedMotion.mockClear();
    h.setColorBlindSafePalette.mockClear();
  });

  it("renders without crashing", () => {
    const { container } = render(<AccessibilitySection />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the ACCESSIBILITY heading", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText(/ACCESSIBILITY/i)).toBeInTheDocument();
  });

  it("renders the DISPLAY card header", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("DISPLAY")).toBeInTheDocument();
  });

  it("renders Reduce Motion label", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("Reduce Motion")).toBeInTheDocument();
  });

  it("renders Color-Blind Safe Palette label", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("Color-Blind Safe Palette")).toBeInTheDocument();
  });

  it("renders High-Contrast HUD label", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("High-Contrast HUD")).toBeInTheDocument();
  });

  it("renders Bright Daylight label", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("Bright Daylight")).toBeInTheDocument();
  });

  it("renders Text Size label", () => {
    render(<AccessibilitySection />);
    expect(screen.getByText("Text Size")).toBeInTheDocument();
  });

  it("renders the save button for accessibility section", () => {
    render(<AccessibilitySection />);
    expect(screen.getByTestId("save-section-accessibility-btn")).toBeInTheDocument();
  });

  it("renders the reset button for accessibility section", () => {
    render(<AccessibilitySection />);
    expect(screen.getByTestId("reset-section-accessibility-btn")).toBeInTheDocument();
  });

  it("clicking the reset button calls resetSection('accessibility')", () => {
    render(<AccessibilitySection />);
    fireEvent.click(screen.getByTestId("reset-section-accessibility-btn"));
    expect(h.resetSection).toHaveBeenCalledWith("accessibility");
  });
});
