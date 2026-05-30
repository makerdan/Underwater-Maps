/**
 * Bright Daylight mode unit tests.
 *
 * 1. AccessibilityClassesEffect (imported from App.tsx) — verifies
 *    body.bs-daylight is toggled in sync with the brightDaylight setting.
 * 2. deriveEffectiveColormapTheme (imported from settingsStore.ts) — verifies
 *    the grayscale auto-switch logic used by TerrainMesh when brightDaylight
 *    is on.
 *
 * Both tests exercise the real production code paths, not local re-implementations.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

// ---- Real production exports under test ----
import { AccessibilityClassesEffect } from "@/App";
import { useSettingsStore, DEFAULT_SETTINGS, deriveEffectiveColormapTheme } from "@/lib/settingsStore";
import type { ColormapTheme } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
}

// ---------------------------------------------------------------------------
// Tests: body.bs-daylight via real AccessibilityClassesEffect
// ---------------------------------------------------------------------------

describe("AccessibilityClassesEffect — body.bs-daylight", () => {
  beforeEach(() => {
    resetStore();
    document.body.classList.remove("bs-daylight");
  });

  afterEach(() => {
    document.body.classList.remove("bs-daylight");
  });

  it("does NOT add bs-daylight when brightDaylight defaults to false", () => {
    expect(useSettingsStore.getState().brightDaylight).toBe(false);
    render(<AccessibilityClassesEffect />);
    expect(document.body.classList.contains("bs-daylight")).toBe(false);
  });

  it("adds bs-daylight when brightDaylight is set to true before mount", () => {
    useSettingsStore.getState().setBrightDaylight(true);
    render(<AccessibilityClassesEffect />);
    expect(document.body.classList.contains("bs-daylight")).toBe(true);
  });

  it("adds bs-daylight reactively when brightDaylight is toggled on after mount", () => {
    render(<AccessibilityClassesEffect />);
    expect(document.body.classList.contains("bs-daylight")).toBe(false);

    act(() => {
      useSettingsStore.getState().setBrightDaylight(true);
    });
    expect(document.body.classList.contains("bs-daylight")).toBe(true);
  });

  it("removes bs-daylight reactively when brightDaylight is toggled off", () => {
    useSettingsStore.getState().setBrightDaylight(true);
    render(<AccessibilityClassesEffect />);
    expect(document.body.classList.contains("bs-daylight")).toBe(true);

    act(() => {
      useSettingsStore.getState().setBrightDaylight(false);
    });
    expect(document.body.classList.contains("bs-daylight")).toBe(false);
  });

  it("toggling brightDaylight multiple times keeps body class in sync", () => {
    render(<AccessibilityClassesEffect />);

    act(() => { useSettingsStore.getState().setBrightDaylight(true); });
    expect(document.body.classList.contains("bs-daylight")).toBe(true);

    act(() => { useSettingsStore.getState().setBrightDaylight(false); });
    expect(document.body.classList.contains("bs-daylight")).toBe(false);

    act(() => { useSettingsStore.getState().setBrightDaylight(true); });
    expect(document.body.classList.contains("bs-daylight")).toBe(true);
  });

  it("does not affect other accessibility classes when only brightDaylight changes", () => {
    render(<AccessibilityClassesEffect />);

    act(() => { useSettingsStore.getState().setBrightDaylight(true); });
    expect(document.body.classList.contains("bs-reduced-motion")).toBe(false);
    expect(document.body.classList.contains("bs-large-hud")).toBe(false);
    expect(document.body.classList.contains("bs-high-contrast-hud")).toBe(false);
    expect(document.body.classList.contains("bs-cb-palette")).toBe(false);
    expect(document.body.classList.contains("bs-daylight")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: deriveEffectiveColormapTheme (real production logic from settingsStore)
// ---------------------------------------------------------------------------

describe("deriveEffectiveColormapTheme — grayscale auto-switch logic", () => {
  beforeEach(() => resetStore());

  it("returns 'grayscale' when brightDaylight is on and user has NOT set a colormap", () => {
    expect(deriveEffectiveColormapTheme(true, false, "ocean")).toBe("grayscale");
  });

  it("returns 'grayscale' for freshwater default (brightDaylight on, colormapUserSet false)", () => {
    expect(deriveEffectiveColormapTheme(true, false, "freshwater")).toBe("grayscale");
  });

  it("returns 'grayscale' for viridis default when brightDaylight on and colormapUserSet false", () => {
    expect(deriveEffectiveColormapTheme(true, false, "viridis")).toBe("grayscale");
  });

  it("respects a manual colormap override when colormapUserSet is true (even with brightDaylight on)", () => {
    expect(deriveEffectiveColormapTheme(true, true, "thermal")).toBe("thermal");
  });

  it("respects a manual grayscale choice when colormapUserSet is true", () => {
    expect(deriveEffectiveColormapTheme(true, true, "grayscale")).toBe("grayscale");
  });

  it("respects any manual colormap when colormapUserSet is true and brightDaylight is on", () => {
    const themes: ColormapTheme[] = ["ocean", "thermal", "viridis", "freshwater", "custom"];
    for (const theme of themes) {
      expect(deriveEffectiveColormapTheme(true, true, theme)).toBe(theme);
    }
  });

  it("passes through the active theme unchanged when brightDaylight is off", () => {
    const themes: ColormapTheme[] = ["ocean", "thermal", "grayscale", "viridis", "freshwater", "custom"];
    for (const theme of themes) {
      expect(deriveEffectiveColormapTheme(false, false, theme)).toBe(theme);
      expect(deriveEffectiveColormapTheme(false, true, theme)).toBe(theme);
    }
  });

  it("store defaults: brightDaylight false and colormapUserSet false → theme passes through", () => {
    const s = useSettingsStore.getState();
    expect(s.brightDaylight).toBe(false);
    expect(s.colormapUserSet).toBe(false);
    expect(deriveEffectiveColormapTheme(s.brightDaylight, s.colormapUserSet, s.colormapTheme)).toBe(
      s.colormapTheme,
    );
  });

  it("store: enabling brightDaylight with default colormapUserSet=false auto-switches to grayscale", () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, brightDaylight: true });
    const s = useSettingsStore.getState();
    expect(deriveEffectiveColormapTheme(s.brightDaylight, s.colormapUserSet, s.colormapTheme)).toBe(
      "grayscale",
    );
  });

  it("store: enabling brightDaylight but colormapUserSet=true respects user's choice", () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, brightDaylight: true, colormapUserSet: true, colormapTheme: "viridis" });
    const s = useSettingsStore.getState();
    expect(deriveEffectiveColormapTheme(s.brightDaylight, s.colormapUserSet, s.colormapTheme)).toBe(
      "viridis",
    );
  });
});
