import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { tempToColor, THERMAL_MIN_C, THERMAL_MAX_C } from "@/lib/thermalColormap";

describe("tempToColor", () => {
  it("returns a THREE.Color instance for any input", () => {
    expect(tempToColor(15)).toBeInstanceOf(THREE.Color);
  });

  it("returns a warm hue (red channel dominates) for temperatures ≥ THERMAL_MAX_C", () => {
    const hot = tempToColor(THERMAL_MAX_C);
    // The warm end stops are red (#dc2626) and orange (#f97316) — red always dominates blue
    expect(hot.r).toBeGreaterThan(hot.b);
  });

  it("clamps above THERMAL_MAX_C to the same colour as at THERMAL_MAX_C", () => {
    const maxColor = tempToColor(THERMAL_MAX_C);
    const aboveMax = tempToColor(999);
    expect(aboveMax.r).toBeCloseTo(maxColor.r, 4);
    expect(aboveMax.g).toBeCloseTo(maxColor.g, 4);
    expect(aboveMax.b).toBeCloseTo(maxColor.b, 4);
  });

  it("returns a cool hue (blue channel ≥ red) for temperatures ≤ THERMAL_MIN_C", () => {
    const cold = tempToColor(THERMAL_MIN_C);
    // Cold end is deep purple (#3d0c6e) — blue > red in sRGB
    expect(cold.b).toBeGreaterThan(cold.r);
  });

  it("clamps below THERMAL_MIN_C to the same colour as at THERMAL_MIN_C", () => {
    const minColor = tempToColor(THERMAL_MIN_C);
    const belowMin = tempToColor(-100);
    expect(belowMin.r).toBeCloseTo(minColor.r, 4);
    expect(belowMin.g).toBeCloseTo(minColor.g, 4);
    expect(belowMin.b).toBeCloseTo(minColor.b, 4);
  });

  it("returns a blue hue for mid-range temperatures (~10°C, thermocline zone)", () => {
    // At 10°C the gradient is at steel-blue (#0872b5) — blue dominates
    const mid = tempToColor(10);
    expect(mid.b).toBeGreaterThan(mid.r);
  });

  it("returns a warm hue for temperatures near the warm end (~20°C)", () => {
    const warm = tempToColor(20);
    // Near the warm end (orange/red) — red strongly dominates blue
    expect(warm.r).toBeGreaterThan(warm.b);
  });

  it("returns a well-defined colour (not undefined/NaN) for out-of-range inputs", () => {
    for (const v of [-Infinity, Infinity, -5, 50, 0, 100]) {
      const c = tempToColor(v);
      expect(c).toBeInstanceOf(THREE.Color);
      expect(Number.isFinite(c.r)).toBe(true);
      expect(Number.isFinite(c.g)).toBe(true);
      expect(Number.isFinite(c.b)).toBe(true);
    }
  });

  it("NaN input does not throw and returns the cold-end colour", () => {
    expect(() => tempToColor(NaN)).not.toThrow();
    const nanColor = tempToColor(NaN);
    const coldColor = tempToColor(THERMAL_MIN_C);
    expect(nanColor.r).toBeCloseTo(coldColor.r, 4);
    expect(nanColor.b).toBeCloseTo(coldColor.b, 4);
  });

  it("warm end has more red and less blue than the cold end", () => {
    const cold = tempToColor(THERMAL_MIN_C);
    const hot  = tempToColor(THERMAL_MAX_C);
    expect(hot.r).toBeGreaterThan(cold.r);
    expect(cold.b).toBeGreaterThan(hot.b);
  });

  it("produces a distinctly different colour at each named gradient stop", () => {
    const points = [2, 6, 10, 13, 16, 19, 22];
    const colors = points.map(tempToColor);
    for (let i = 1; i < colors.length; i++) {
      const prev = colors[i - 1]!;
      const curr = colors[i]!;
      const diff = Math.abs(prev.r - curr.r) + Math.abs(prev.g - curr.g) + Math.abs(prev.b - curr.b);
      expect(diff).toBeGreaterThan(0.01);
    }
  });
});
