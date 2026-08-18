/**
 * Unit tests for getColormapTRange and colormapCssGradient in colormap.ts.
 *
 * Regression guard: a change to OCEAN_MAX_DEPTH_M, the tRange crop formula,
 * or the CSS gradient sampling would silently misalign the legend strip with
 * the painted terrain without these tests.
 */
import { describe, it, expect } from "vitest";
import {
  getColormapTRange,
  colormapCssGradient,
  OCEAN_MAX_DEPTH_M,
} from "../colormap";

// ---------------------------------------------------------------------------
// getColormapTRange — fixed (grid-relative) themes always return full [0, 1]
// ---------------------------------------------------------------------------

describe("getColormapTRange — fixed themes", () => {
  const fixedThemes = ["thermal", "grayscale", "viridis", "freshwater", "pastel"] as const;

  for (const theme of fixedThemes) {
    it(`${theme}: always returns { tMin: 0, tMax: 1 } regardless of depth range`, () => {
      expect(getColormapTRange(theme, 0, 100)).toEqual({ tMin: 0, tMax: 1 });
      expect(getColormapTRange(theme, 50, 500)).toEqual({ tMin: 0, tMax: 1 });
      expect(getColormapTRange(theme, 0, OCEAN_MAX_DEPTH_M)).toEqual({ tMin: 0, tMax: 1 });
    });
  }
});

// ---------------------------------------------------------------------------
// getColormapTRange — absolute (ocean / custom) themes crop to depth range
// ---------------------------------------------------------------------------

describe("getColormapTRange — ocean theme (absolute depth scale)", () => {
  it("full-depth dataset spanning 0 → OCEAN_MAX_DEPTH_M returns [0, 1]", () => {
    const { tMin, tMax } = getColormapTRange("ocean", 0, OCEAN_MAX_DEPTH_M);
    expect(tMin).toBeCloseTo(0, 5);
    expect(tMax).toBeCloseTo(1, 5);
  });

  it("mid-depth dataset returns proportional tMin / tMax", () => {
    // 100 m to 300 m out of ~609.6 m total
    const { tMin, tMax } = getColormapTRange("ocean", 100, 300);
    expect(tMin).toBeCloseTo(100 / OCEAN_MAX_DEPTH_M, 5);
    expect(tMax).toBeCloseTo(300 / OCEAN_MAX_DEPTH_M, 5);
    expect(tMin).toBeGreaterThan(0);
    expect(tMax).toBeLessThan(1);
  });

  it("very shallow dataset (0–5 m) produces tMax well below 0.1", () => {
    const { tMin, tMax } = getColormapTRange("ocean", 0, 5);
    // 5 / 609.6 ≈ 0.0082 — legend must show only the shallow slice
    expect(tMin).toBeCloseTo(0, 5);
    expect(tMax).toBeLessThan(0.1);
  });

  it("shallow lake (0–15 m) still has tMax < 0.1", () => {
    // 15 m / 609.6 m ≈ 0.0246
    const { tMin: _tMin, tMax } = getColormapTRange("ocean", 0, 15);
    expect(tMax).toBeLessThan(0.1);
  });

  it("tMax > tMin for any valid depth range", () => {
    const { tMin, tMax } = getColormapTRange("ocean", 50, 400);
    expect(tMax).toBeGreaterThan(tMin);
  });

  it("clamps tMin to 0 when gridMin is 0", () => {
    const { tMin } = getColormapTRange("ocean", 0, 200);
    expect(tMin).toBe(0);
  });

  it("clamps tMax to 1 when gridMax exceeds OCEAN_MAX_DEPTH_M", () => {
    const { tMax } = getColormapTRange("ocean", 0, OCEAN_MAX_DEPTH_M * 2);
    expect(tMax).toBe(1);
  });

  it("inverted / zero-span range (gridMin >= gridMax) falls back to [0, 1]", () => {
    expect(getColormapTRange("ocean", 200, 200)).toEqual({ tMin: 0, tMax: 1 });
    expect(getColormapTRange("ocean", 300, 100)).toEqual({ tMin: 0, tMax: 1 });
  });
});

describe("getColormapTRange — custom theme mirrors ocean behaviour", () => {
  it("proportional crop identical to ocean for same inputs", () => {
    const ocean = getColormapTRange("ocean", 100, 300);
    const custom = getColormapTRange("custom", 100, 300);
    expect(custom.tMin).toBeCloseTo(ocean.tMin, 10);
    expect(custom.tMax).toBeCloseTo(ocean.tMax, 10);
  });

  it("very shallow (0–5 m) tMax < 0.1", () => {
    const { tMax } = getColormapTRange("custom", 0, 5);
    expect(tMax).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// colormapCssGradient — output format
// ---------------------------------------------------------------------------

describe("colormapCssGradient — CSS output format", () => {
  const RGB_STOP_RE = /rgb\(\d{1,3},\d{1,3},\d{1,3}\)/g;

  it("returns a string starting with 'linear-gradient('", () => {
    const css = colormapCssGradient("thermal");
    expect(css).toMatch(/^linear-gradient\(/);
  });

  it("contains the specified direction", () => {
    expect(colormapCssGradient("thermal", "to bottom")).toContain("to bottom");
    expect(colormapCssGradient("viridis", "to right")).toContain("to right");
  });

  it("contains at least 2 rgb(…) stops for every theme", () => {
    const themes = ["ocean", "thermal", "grayscale", "viridis", "freshwater", "pastel", "custom"] as const;
    for (const theme of themes) {
      const css = colormapCssGradient(theme);
      const matches = css.match(RGB_STOP_RE);
      expect(matches, `${theme} should have rgb stops`).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("all rgb(…) channel values are integers in [0, 255]", () => {
    const css = colormapCssGradient("viridis", "to right", 8);
    const matches = css.match(RGB_STOP_RE)!;
    expect(matches.length).toBeGreaterThan(0);
    for (const stop of matches) {
      const [r, g, b] = stop.slice(4, -1).split(",").map(Number);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it("percentage stops end with '%' and are in [0, 100]", () => {
    const css = colormapCssGradient("grayscale", "to right", 5);
    // Each stop is like "rgb(R,G,B) P.PP%"
    const pctRe = /(\d+(?:\.\d+)?)%/g;
    const matches = [...css.matchAll(pctRe)].map((m) => parseFloat(m[1]!));
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0]).toBeCloseTo(0, 1);
    expect(matches[matches.length - 1]).toBeCloseTo(100, 1);
    for (const p of matches) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("default samples=12 produces exactly 12 rgb stops", () => {
    const css = colormapCssGradient("thermal");
    const matches = css.match(RGB_STOP_RE);
    expect(matches).toHaveLength(12);
  });

  it("custom samples=4 produces exactly 4 rgb stops", () => {
    const css = colormapCssGradient("grayscale", "to right", 4);
    const matches = css.match(RGB_STOP_RE);
    expect(matches).toHaveLength(4);
  });

  it("samples clamped to minimum 2 even when 1 is requested", () => {
    const css = colormapCssGradient("grayscale", "to right", 1);
    const matches = css.match(RGB_STOP_RE);
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// colormapCssGradient — tRange integration (legend ↔ terrain alignment)
// ---------------------------------------------------------------------------

describe("colormapCssGradient — tRange crops the ramp for absolute themes", () => {
  it("with tRange [0,1] and without tRange produce the same gradient string", () => {
    const noRange = colormapCssGradient("thermal", "to right", 6);
    const fullRange = colormapCssGradient("thermal", "to right", 6, undefined, {
      tMin: 0,
      tMax: 1,
    });
    expect(fullRange).toBe(noRange);
  });

  it("a shallow crop tRange produces a different gradient than the full ramp", () => {
    const fullGradient = colormapCssGradient("ocean", "to right", 8);
    const shallowTRange = getColormapTRange("ocean", 0, 5); // ~0–0.008
    const shallowGradient = colormapCssGradient(
      "ocean",
      "to right",
      8,
      undefined,
      shallowTRange,
    );
    // Shallow slice should sample only the near-surface colours
    expect(shallowGradient).not.toBe(fullGradient);
  });

  it("cropped gradient for a mid-depth range differs from both full and shallow", () => {
    const full = colormapCssGradient("ocean", "to right", 8);
    const shallow = colormapCssGradient("ocean", "to right", 8, undefined, {
      tMin: 0,
      tMax: 0.05,
    });
    const mid = colormapCssGradient("ocean", "to right", 8, undefined, {
      tMin: 0.3,
      tMax: 0.7,
    });
    expect(mid).not.toBe(full);
    expect(mid).not.toBe(shallow);
  });

  it("fixed theme (thermal) gradient is unaffected by a tRange crop — same output either way", () => {
    // For grid-relative themes the tRange from getColormapTRange is always {0,1};
    // passing it explicitly must produce identical output.
    const tRange = getColormapTRange("thermal", 0, 100);
    expect(tRange).toEqual({ tMin: 0, tMax: 1 });
    const withRange = colormapCssGradient("thermal", "to right", 8, undefined, tRange);
    const without = colormapCssGradient("thermal", "to right", 8);
    expect(withRange).toBe(without);
  });
});
