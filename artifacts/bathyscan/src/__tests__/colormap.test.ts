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

import { depthToColor } from "../lib/colormap";

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
