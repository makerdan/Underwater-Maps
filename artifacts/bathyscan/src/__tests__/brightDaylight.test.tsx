/**
 * Bright Daylight mode unit tests.
 *
 * 1. AccessibilityClassesEffect (imported from App.tsx) — verifies
 *    body.bs-daylight is toggled in sync with the brightDaylight setting.
 * 2. deriveEffectiveColormapTheme (imported from settingsStore.ts) — verifies
 *    the grayscale auto-switch logic used by TerrainMesh when brightDaylight
 *    is on.
 * 3. CSS source integrity — reads the real index.css and asserts the expected
 *    variable values/properties are present in the body.bs-daylight block.
 * 4. CSS cascade — injects a minimal <style> tag into jsdom and verifies that
 *    CSS custom properties on child elements actually change when bs-daylight
 *    is toggled on body.
 *
 * Both tests exercise the real production code paths, not local re-implementations.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, act } from "@testing-library/react";

// ---- Real production exports under test ----
import { AccessibilityClassesEffect } from "@/App";
import { useSettingsStore, DEFAULT_SETTINGS, deriveEffectiveColormapTheme, FONT_SIZE_SCALE } from "@/lib/settingsStore";
import type { ColormapTheme, FontSizeLevel } from "@/lib/settingsStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
  document.body.style.removeProperty("--bs-font-scale");
  document.body.style.fontSize = "";
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

// ---------------------------------------------------------------------------
// CSS source integrity — body.bs-daylight variable definitions in index.css
// ---------------------------------------------------------------------------

/**
 * Extract the first brace-balanced block following `selector` in raw CSS text.
 * Returns the content between the opening `{` and its matching `}`.
 */
function extractCssBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) return "";
  const open = css.indexOf("{", idx);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

const cssSource = readFileSync(resolve(__dirname, "../index.css"), "utf-8");

describe("CSS source integrity — body.bs-daylight variable definitions", () => {
  const daylightBlock = extractCssBlock(cssSource, "body.bs-daylight");
  const rootBlock = extractCssBlock(cssSource, ":root");

  it("the body.bs-daylight block exists in index.css", () => {
    expect(daylightBlock.length).toBeGreaterThan(0);
  });

  it("defines --background as a high-luminance light value (210 20% 96%)", () => {
    expect(daylightBlock).toContain("--background: 210 20% 96%");
  });

  it("defines --foreground as near-black for outdoor readability (0 0% 4%)", () => {
    expect(daylightBlock).toContain("--foreground: 0 0% 4%");
  });

  it("defines --primary as cobalt blue accent (224 75% 40%)", () => {
    expect(daylightBlock).toContain("--primary: 224 75% 40%");
  });

  it("defines --accent as cobalt blue matching --primary (224 75% 40%)", () => {
    expect(daylightBlock).toContain("--accent: 224 75% 40%");
  });

  it("defines --ring as cobalt blue for focus rings (224 75% 40%)", () => {
    expect(daylightBlock).toContain("--ring: 224 75% 40%");
  });

  it("sets font-weight: 500 for outdoor legibility", () => {
    expect(daylightBlock).toContain("font-weight: 500");
  });

  it("sets font-size: 25.5px for outdoor legibility", () => {
    expect(daylightBlock).toContain("font-size: 25.5px");
  });

  it("daylight --primary (cobalt) differs from :root --primary (cyan)", () => {
    expect(rootBlock).toContain("--primary: 195 100% 55%");
    expect(daylightBlock).toContain("--primary: 224 75% 40%");
    expect(daylightBlock).not.toContain("--primary: 195 100% 55%");
  });

  it("daylight --background is light (96% lightness) vs dark :root background (4% lightness)", () => {
    expect(rootBlock).toContain("--background: 221 60% 4%");
    expect(daylightBlock).toContain("--background: 210 20% 96%");
  });

  it("daylight --foreground is near-black vs light :root foreground", () => {
    expect(rootBlock).toContain("--foreground: 210 30% 88%");
    expect(daylightBlock).toContain("--foreground: 0 0% 4%");
  });

  it("panel surfaces get #ffffff background with !important override", () => {
    expect(cssSource).toContain("body.bs-daylight .habitat-panel");
    const panelRuleIdx = cssSource.indexOf("body.bs-daylight .habitat-panel");
    const panelBlock = cssSource.slice(panelRuleIdx, cssSource.indexOf("}", panelRuleIdx) + 1);
    expect(panelBlock).toContain("background: #ffffff !important");
  });

  it("panel surfaces get cobalt border-color with !important override", () => {
    const panelRuleIdx = cssSource.indexOf("body.bs-daylight .habitat-panel");
    const panelBlock = cssSource.slice(panelRuleIdx, cssSource.indexOf("}", panelRuleIdx) + 1);
    expect(panelBlock).toContain("border-color: rgba(30, 58, 130, 0.4) !important");
  });

  it("global child rule forces color: #0a0a0a !important for outdoor text legibility", () => {
    expect(cssSource).toContain("body.bs-daylight *");
    const starRuleIdx = cssSource.indexOf("body.bs-daylight *,");
    const starBlock = cssSource.slice(starRuleIdx, cssSource.indexOf("}", starRuleIdx) + 1);
    expect(starBlock).toContain("color: #0a0a0a !important");
  });

  it("global child rule disables backdrop-filter for outdoor use", () => {
    const starRuleIdx = cssSource.indexOf("body.bs-daylight *,");
    const starBlock = cssSource.slice(starRuleIdx, cssSource.indexOf("}", starRuleIdx) + 1);
    expect(starBlock).toContain("backdrop-filter: none !important");
  });
});

// ---------------------------------------------------------------------------
// CSS cascade — custom properties actually change on child elements in jsdom
// ---------------------------------------------------------------------------

/**
 * The minimal CSS rules needed to verify the cascade, stripped of Tailwind
 * imports and @layer/@theme directives that jsdom cannot parse.
 */
const INJECTED_CSS = `
  :root {
    --primary: 195 100% 55%;
    --accent: 195 100% 55%;
    --background: 221 60% 4%;
    --foreground: 210 30% 88%;
  }
  body.bs-daylight {
    --primary: 224 75% 40%;
    --accent: 224 75% 40%;
    --background: 210 20% 96%;
    --foreground: 0 0% 4%;
  }
`;

describe("CSS cascade — custom properties change on-screen when bs-daylight is active", () => {
  let styleEl: HTMLStyleElement;
  let child: HTMLDivElement;

  beforeEach(() => {
    document.body.classList.remove("bs-daylight");
    styleEl = document.createElement("style");
    styleEl.textContent = INJECTED_CSS;
    document.head.appendChild(styleEl);
    child = document.createElement("div");
    document.body.appendChild(child);
  });

  afterEach(() => {
    document.body.classList.remove("bs-daylight");
    styleEl.remove();
    child.remove();
  });

  it("--primary changes from cyan to cobalt when bs-daylight class is added", () => {
    const before = getComputedStyle(child).getPropertyValue("--primary").trim();
    expect(before).toBe("195 100% 55%");

    document.body.classList.add("bs-daylight");
    const after = getComputedStyle(child).getPropertyValue("--primary").trim();
    expect(after).toBe("224 75% 40%");
    expect(after).not.toBe(before);
  });

  it("--accent changes from cyan to cobalt when bs-daylight class is added", () => {
    const before = getComputedStyle(child).getPropertyValue("--accent").trim();
    expect(before).toBe("195 100% 55%");

    document.body.classList.add("bs-daylight");
    const after = getComputedStyle(child).getPropertyValue("--accent").trim();
    expect(after).toBe("224 75% 40%");
  });

  it("--background changes to high-luminance value when bs-daylight class is added", () => {
    const before = getComputedStyle(child).getPropertyValue("--background").trim();
    expect(before).toBe("221 60% 4%");

    document.body.classList.add("bs-daylight");
    const after = getComputedStyle(child).getPropertyValue("--background").trim();
    expect(after).toBe("210 20% 96%");
  });

  it("--foreground changes to near-black when bs-daylight class is added", () => {
    const before = getComputedStyle(child).getPropertyValue("--foreground").trim();
    expect(before).toBe("210 30% 88%");

    document.body.classList.add("bs-daylight");
    const after = getComputedStyle(child).getPropertyValue("--foreground").trim();
    expect(after).toBe("0 0% 4%");
  });

  it("removing bs-daylight restores the :root --primary cyan value", () => {
    document.body.classList.add("bs-daylight");
    expect(getComputedStyle(child).getPropertyValue("--primary").trim()).toBe("224 75% 40%");

    document.body.classList.remove("bs-daylight");
    expect(getComputedStyle(child).getPropertyValue("--primary").trim()).toBe("195 100% 55%");
  });

  it("toggling bs-daylight twice keeps --accent in sync with the class state", () => {
    document.body.classList.add("bs-daylight");
    expect(getComputedStyle(child).getPropertyValue("--accent").trim()).toBe("224 75% 40%");

    document.body.classList.remove("bs-daylight");
    expect(getComputedStyle(child).getPropertyValue("--accent").trim()).toBe("195 100% 55%");

    document.body.classList.add("bs-daylight");
    expect(getComputedStyle(child).getPropertyValue("--accent").trim()).toBe("224 75% 40%");
  });
});

// ---------------------------------------------------------------------------
// globalFontSize — AccessibilityClassesEffect sets --bs-font-scale correctly
// ---------------------------------------------------------------------------

describe("AccessibilityClassesEffect — globalFontSize applies --bs-font-scale", () => {
  beforeEach(() => {
    resetStore();
    document.body.style.removeProperty("--bs-font-scale");
    document.body.style.fontSize = "";
  });

  afterEach(() => {
    document.body.style.removeProperty("--bs-font-scale");
    document.body.style.fontSize = "";
  });

  const LEVELS: FontSizeLevel[] = ["smallest", "small", "medium", "large", "x-large", "largest"];

  for (const level of LEVELS) {
    it(`sets --bs-font-scale to ${FONT_SIZE_SCALE[level]} for level "${level}"`, () => {
      useSettingsStore.getState().setGlobalFontSize(level);
      render(<AccessibilityClassesEffect />);
      const cssVar = document.body.style.getPropertyValue("--bs-font-scale");
      expect(Number(cssVar)).toBeCloseTo(FONT_SIZE_SCALE[level], 3);
    });
  }

  it("defaults to --bs-font-scale 1 for medium (no font-size override)", () => {
    render(<AccessibilityClassesEffect />);
    expect(useSettingsStore.getState().globalFontSize).toBe("medium");
    const cssVar = document.body.style.getPropertyValue("--bs-font-scale");
    expect(Number(cssVar)).toBe(1);
    expect(document.body.style.fontSize).toBe("");
  });

  it("sets a non-empty font-size for levels other than medium", () => {
    const nonMedium: FontSizeLevel[] = ["smallest", "small", "large", "x-large", "largest"];
    for (const level of nonMedium) {
      act(() => { useSettingsStore.getState().setGlobalFontSize(level); });
    }
    render(<AccessibilityClassesEffect />);
    expect(document.body.style.fontSize).not.toBe("");
  });

  it("updates --bs-font-scale reactively when globalFontSize changes after mount", () => {
    render(<AccessibilityClassesEffect />);

    act(() => { useSettingsStore.getState().setGlobalFontSize("largest"); });
    expect(Number(document.body.style.getPropertyValue("--bs-font-scale"))).toBeCloseTo(1.45, 3);

    act(() => { useSettingsStore.getState().setGlobalFontSize("smallest"); });
    expect(Number(document.body.style.getPropertyValue("--bs-font-scale"))).toBeCloseTo(0.80, 3);

    act(() => { useSettingsStore.getState().setGlobalFontSize("medium"); });
    expect(Number(document.body.style.getPropertyValue("--bs-font-scale"))).toBe(1);
  });
});
