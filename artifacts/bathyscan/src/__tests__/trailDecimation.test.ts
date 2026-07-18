/**
 * decimateTrailPoints — uniform index decimation for 3D trail rendering.
 */
import { describe, it, expect } from "vitest";
import {
  decimateTrailPoints,
  MAX_RENDERED_TRAIL_POINTS,
} from "@/lib/trailDecimation";

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("decimateTrailPoints", () => {
  it("returns a copy when under the cap", () => {
    const pts = seq(10);
    const out = decimateTrailPoints(pts, 100);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });

  it("returns the input unchanged in length when exactly at the cap", () => {
    expect(decimateTrailPoints(seq(500), 500)).toHaveLength(500);
  });

  it("caps output length at maxPoints", () => {
    const out = decimateTrailPoints(seq(10_000), 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.length).toBeGreaterThan(490);
  });

  it("always keeps the first and last points", () => {
    const out = decimateTrailPoints(seq(9_999), 250);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(9_998);
  });

  it("preserves ordering (monotonically increasing indices)", () => {
    const out = decimateTrailPoints(seq(5_000), 333);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThan(out[i - 1]!);
    }
  });

  it("handles edge cases", () => {
    expect(decimateTrailPoints([], 100)).toEqual([]);
    expect(decimateTrailPoints(seq(5), 0)).toEqual([]);
    expect(decimateTrailPoints(seq(5), 1)).toEqual([4]);
    expect(decimateTrailPoints([7], 100)).toEqual([7]);
  });

  it("uses the exported default cap", () => {
    const out = decimateTrailPoints(seq(10_000));
    expect(out.length).toBeLessThanOrEqual(MAX_RENDERED_TRAIL_POINTS);
  });
});
