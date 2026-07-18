import { describe, it, expect } from "vitest";
import {
  prepareTideSamples,
  interpolateTideHeightFt,
  interpolateTideHeightMeters,
  FEET_TO_METERS,
  type TideSample,
} from "@/lib/tidePrediction";

const T0 = Date.UTC(2026, 6, 18, 0, 0);
const SIX_MIN = 6 * 60_000;

function samples(values: number[]): TideSample[] {
  return values.map((v, i) => ({ tMs: T0 + i * SIX_MIN, v }));
}

describe("prepareTideSamples", () => {
  it("parses ISO timestamps, drops junk, and sorts ascending", () => {
    const out = prepareTideSamples([
      { t: "2026-07-18T00:12:00.000Z", v: 2 },
      { t: "2026-07-18T00:00:00.000Z", v: 0 },
      { t: "not-a-date", v: 5 },
      { t: "2026-07-18T00:06:00.000Z", v: NaN },
    ]);
    expect(out).toEqual([
      { tMs: T0, v: 0 },
      { tMs: T0 + 2 * SIX_MIN, v: 2 },
    ]);
  });
});

describe("interpolateTideHeightFt boundaries", () => {
  it("returns null for an empty series", () => {
    expect(interpolateTideHeightFt([], T0)).toBeNull();
  });

  it("returns null for a non-finite time", () => {
    expect(interpolateTideHeightFt(samples([1, 2]), NaN)).toBeNull();
  });

  it("clamps to the first sample at/before the window start", () => {
    const s = samples([1.5, 2.0, 2.5]);
    expect(interpolateTideHeightFt(s, T0)).toBe(1.5);
    expect(interpolateTideHeightFt(s, T0 - 86_400_000)).toBe(1.5);
  });

  it("clamps to the last sample at/after the window end", () => {
    const s = samples([1.5, 2.0, 2.5]);
    expect(interpolateTideHeightFt(s, T0 + 2 * SIX_MIN)).toBe(2.5);
    expect(interpolateTideHeightFt(s, T0 + 100 * SIX_MIN)).toBe(2.5);
  });

  it("returns exact values at sample timestamps", () => {
    const s = samples([1.0, 3.0, 2.0]);
    expect(interpolateTideHeightFt(s, T0 + SIX_MIN)).toBe(3.0);
  });

  it("linearly interpolates between bracketing samples", () => {
    const s = samples([1.0, 2.0]);
    // Halfway between → 1.5; quarter → 1.25.
    expect(interpolateTideHeightFt(s, T0 + SIX_MIN / 2)).toBeCloseTo(1.5, 10);
    expect(interpolateTideHeightFt(s, T0 + SIX_MIN / 4)).toBeCloseTo(1.25, 10);
  });

  it("handles a single-sample series by clamping", () => {
    const s = samples([4.2]);
    expect(interpolateTideHeightFt(s, T0 - 1)).toBe(4.2);
    expect(interpolateTideHeightFt(s, T0 + 1)).toBe(4.2);
  });

  it("interpolates correctly across a long series (binary search)", () => {
    const vals = Array.from({ length: 7440 }, (_, i) => Math.sin(i / 40));
    const s = samples(vals);
    const i = 5000;
    const mid = T0 + i * SIX_MIN + SIX_MIN / 2;
    const expected = (vals[i]! + vals[i + 1]!) / 2;
    expect(interpolateTideHeightFt(s, mid)).toBeCloseTo(expected, 10);
  });
});

describe("interpolateTideHeightMeters", () => {
  it("converts feet to metres", () => {
    const s = samples([10]);
    expect(interpolateTideHeightMeters(s, T0)).toBeCloseTo(10 * FEET_TO_METERS, 10);
    expect(interpolateTideHeightMeters([], T0)).toBeNull();
  });
});
