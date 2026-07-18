import { describe, it, expect } from "vitest";
import {
  prepareTideSamples,
  interpolateTideHeightFt,
  interpolateTideHeightMeters,
  findTideExtremes,
  extremesInRange,
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

describe("findTideExtremes", () => {
  it("returns empty for fewer than 3 samples", () => {
    expect(findTideExtremes([])).toEqual([]);
    expect(findTideExtremes(samples([1, 2]))).toEqual([]);
  });

  it("finds alternating highs and lows", () => {
    const s = samples([1, 2, 3, 2, 1, 0, 1, 2]);
    expect(findTideExtremes(s)).toEqual([
      { tMs: T0 + 2 * SIX_MIN, v: 3, kind: "high" },
      { tMs: T0 + 5 * SIX_MIN, v: 0, kind: "low" },
    ]);
  });

  it("never reports window endpoints as extremes", () => {
    // Monotonic series: endpoints are the max/min but not true extremes.
    expect(findTideExtremes(samples([1, 2, 3, 4, 5]))).toEqual([]);
  });

  it("collapses a flat plateau to a single midpoint extreme", () => {
    const s = samples([1, 3, 3, 3, 1]);
    const out = findTideExtremes(s);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ tMs: T0 + 2 * SIX_MIN, v: 3, kind: "high" });
  });

  it("plateau at the end of the window is not an extreme", () => {
    expect(findTideExtremes(samples([1, 2, 3, 3, 3]))).toEqual([]);
  });

  it("finds extremes in a sinusoidal series (~2 highs and 2 lows/day)", () => {
    // Semidiurnal-ish: period ~12.4h over 48h of 6-min samples.
    const periodMs = 12.4 * 3_600_000;
    const n = 480; // 48 h
    const s: TideSample[] = Array.from({ length: n }, (_, i) => ({
      tMs: T0 + i * SIX_MIN,
      v: 2 + 2 * Math.sin(((i * SIX_MIN) / periodMs) * 2 * Math.PI),
    }));
    const out = findTideExtremes(s);
    const highs = out.filter((e) => e.kind === "high");
    const lows = out.filter((e) => e.kind === "low");
    expect(highs.length).toBeGreaterThanOrEqual(3);
    expect(lows.length).toBeGreaterThanOrEqual(3);
    for (const h of highs) expect(h.v).toBeCloseTo(4, 1);
    for (const l of lows) expect(l.v).toBeCloseTo(0, 1);
    // Alternation: sorted extremes alternate high/low.
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.kind).not.toBe(out[i - 1]!.kind);
    }
  });
});

describe("extremesInRange", () => {
  it("filters half-open [start, end)", () => {
    const ex = findTideExtremes(samples([1, 2, 1, 0, 1, 2, 1]));
    expect(ex).toHaveLength(3);
    const start = T0 + SIX_MIN;
    const end = T0 + 5 * SIX_MIN;
    const within = extremesInRange(ex, start, end);
    expect(within.map((e) => e.tMs)).toEqual([T0 + SIX_MIN, T0 + 3 * SIX_MIN]);
  });
});

describe("interpolateTideHeightMeters", () => {
  it("converts feet to metres", () => {
    const s = samples([10]);
    expect(interpolateTideHeightMeters(s, T0)).toBeCloseTo(10 * FEET_TO_METERS, 10);
    expect(interpolateTideHeightMeters([], T0)).toBeNull();
  });
});
