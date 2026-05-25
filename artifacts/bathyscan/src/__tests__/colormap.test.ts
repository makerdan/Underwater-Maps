import { describe, it, expect, vi } from "vitest";

vi.mock("three", () => {
  class Color {
    r: number;
    g: number;
    b: number;
    constructor(hex?: string) {
      if (hex) {
        const n = parseInt(hex.replace("#", ""), 16);
        this.r = ((n >> 16) & 0xff) / 255;
        this.g = ((n >> 8) & 0xff) / 255;
        this.b = (n & 0xff) / 255;
      } else {
        this.r = 0;
        this.g = 0;
        this.b = 0;
      }
    }
    clone() {
      const c = new Color();
      c.r = this.r;
      c.g = this.g;
      c.b = this.b;
      return c;
    }
    lerpColors(a: Color, b: Color, alpha: number) {
      this.r = a.r + (b.r - a.r) * alpha;
      this.g = a.g + (b.g - a.g) * alpha;
      this.b = a.b + (b.b - a.b) * alpha;
      return this;
    }
  }
  return { Color };
});

import { depthToColor, getColormap } from "../lib/colormap";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}

const EPSILON = 0.01;

describe("depthToColor", () => {
  it("t=0 returns the shallowest stop colour (#00e5ff)", () => {
    const c = depthToColor(0);
    const expected = hexToRgb("#00e5ff");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=1 returns the deepest stop colour (#283593)", () => {
    const c = depthToColor(1);
    const expected = hexToRgb("#283593");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=0.3 returns the second stop colour (#0d47a1)", () => {
    const c = depthToColor(0.3);
    const expected = hexToRgb("#0d47a1");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("t=0.5 returns an interpolated colour between the 2nd and 3rd stops", () => {
    const c = depthToColor(0.5);
    // Should be between #0d47a1 (t=0.30) and #1a237e (t=0.65)
    const lo = hexToRgb("#0d47a1");
    const hi = hexToRgb("#1a237e");
    expect(c.r).toBeGreaterThanOrEqual(Math.min(lo.r, hi.r) - EPSILON);
    expect(c.r).toBeLessThanOrEqual(Math.max(lo.r, hi.r) + EPSILON);
  });

  it("t < 0 clamps to t=0", () => {
    const cNeg = depthToColor(-5);
    const c0 = depthToColor(0);
    expect(cNeg.r).toBeCloseTo(c0.r, 2);
    expect(cNeg.g).toBeCloseTo(c0.g, 2);
  });

  it("t > 1 clamps to t=1", () => {
    const cOver = depthToColor(999);
    const c1 = depthToColor(1);
    expect(cOver.r).toBeCloseTo(c1.r, 2);
    expect(cOver.b).toBeCloseTo(c1.b, 2);
  });
});

describe("getColormap", () => {
  it("returns a function for every supported theme", () => {
    const themes = ["ocean", "thermal", "grayscale", "viridis"] as const;
    for (const theme of themes) {
      const fn = getColormap(theme);
      expect(typeof fn).toBe("function");
    }
  });

  it("thermal t=0 → darkest stop (#0d0221)", () => {
    const fn = getColormap("thermal");
    const c = fn(0);
    const expected = hexToRgb("#0d0221");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("thermal t=1 → lightest stop (white #ffffff)", () => {
    const fn = getColormap("thermal");
    const c = fn(1);
    expect(c.r).toBeCloseTo(1, 2);
    expect(c.g).toBeCloseTo(1, 2);
    expect(c.b).toBeCloseTo(1, 2);
  });

  it("thermal t=0.25 → mid stop (#7b2d8b)", () => {
    const fn = getColormap("thermal");
    const c = fn(0.25);
    const expected = hexToRgb("#7b2d8b");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("thermal t=0.5 → interpolated between purple (#7b2d8b) and orange-red (#e8553e)", () => {
    const fn = getColormap("thermal");
    const c = fn(0.5);
    const lo = hexToRgb("#7b2d8b"); // t=0.25 stop
    const hi = hexToRgb("#e8553e"); // t=0.55 stop
    // t=0.5 lies between stops 0.25 and 0.55; result must be within that range
    expect(c.r).toBeGreaterThan(Math.min(lo.r, hi.r) - EPSILON);
    expect(c.r).toBeLessThan(Math.max(lo.r, hi.r) + EPSILON);
    expect(c.g).toBeGreaterThan(Math.min(lo.g, hi.g) - EPSILON);
    expect(c.g).toBeLessThan(Math.max(lo.g, hi.g) + EPSILON);
    expect(c.b).toBeGreaterThan(Math.min(lo.b, hi.b) - EPSILON);
    expect(c.b).toBeLessThan(Math.max(lo.b, hi.b) + EPSILON);
  });

  it("grayscale t=0 → near black (#050505)", () => {
    const fn = getColormap("grayscale");
    const c = fn(0);
    const expected = hexToRgb("#050505");
    expect(c.r).toBeCloseTo(expected.r, 2);
  });

  it("grayscale t=1 → near white (#e0e0e0)", () => {
    const fn = getColormap("grayscale");
    const c = fn(1);
    const expected = hexToRgb("#e0e0e0");
    expect(c.r).toBeCloseTo(expected.r, 2);
  });

  it("viridis t=0 → deep purple (#440154)", () => {
    const fn = getColormap("viridis");
    const c = fn(0);
    const expected = hexToRgb("#440154");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("viridis t=1 → bright yellow (#fde725)", () => {
    const fn = getColormap("viridis");
    const c = fn(1);
    const expected = hexToRgb("#fde725");
    expect(c.r).toBeCloseTo(expected.r, 2);
    expect(c.g).toBeCloseTo(expected.g, 2);
    expect(c.b).toBeCloseTo(expected.b, 2);
  });

  it("ocean theme matches depthToColor at all boundary stops", () => {
    const fn = getColormap("ocean");
    const stops = [0, 0.3, 0.65, 1.0];
    for (const t of stops) {
      const a = fn(t);
      const b = depthToColor(t);
      expect(a.r).toBeCloseTo(b.r, 3);
      expect(a.g).toBeCloseTo(b.g, 3);
      expect(a.b).toBeCloseTo(b.b, 3);
    }
  });

  it("returned function clamps below 0", () => {
    const fn = getColormap("thermal");
    const cNeg = fn(-1);
    const c0 = fn(0);
    expect(cNeg.r).toBeCloseTo(c0.r, 2);
    expect(cNeg.g).toBeCloseTo(c0.g, 2);
  });

  it("returned function clamps above 1", () => {
    const fn = getColormap("viridis");
    const cOver = fn(99);
    const c1 = fn(1);
    expect(cOver.r).toBeCloseTo(c1.r, 2);
    expect(cOver.g).toBeCloseTo(c1.g, 2);
  });
});
