/**
 * contourDensity.test.ts — MOBILE-ONLY math helpers for the mobile Chart
 * View's 1×/2×/3× contour-density stepper and index-contour selection.
 */
import { describe, it, expect } from "vitest";
import {
  applyContourDensity,
  contourIntervalToMetres,
  isIndexContourDepth,
  toValidContourDensity,
  CONTOUR_DENSITY_VALUES,
  INDEX_CONTOUR_EVERY,
} from "@/lib/contourDensity";

describe("toValidContourDensity", () => {
  it("passes through the valid stepper values", () => {
    expect(toValidContourDensity(1)).toBe(1);
    expect(toValidContourDensity(2)).toBe(2);
    expect(toValidContourDensity(3)).toBe(3);
  });

  it("falls back to 1 for anything else (corrupt sync / old storage)", () => {
    expect(toValidContourDensity(0)).toBe(1);
    expect(toValidContourDensity(4)).toBe(1);
    expect(toValidContourDensity(2.5)).toBe(1);
    expect(toValidContourDensity("2")).toBe(1);
    expect(toValidContourDensity(null)).toBe(1);
    expect(toValidContourDensity(undefined)).toBe(1);
    expect(toValidContourDensity(NaN)).toBe(1);
  });

  it("stepper constants stay in sync with the union", () => {
    expect(CONTOUR_DENSITY_VALUES).toEqual([1, 2, 3]);
  });
});

describe("applyContourDensity", () => {
  it("1× keeps the base interval; 2×/3× divide it", () => {
    expect(applyContourDensity(10, 1)).toBe(10);
    expect(applyContourDensity(10, 2)).toBe(5);
    expect(applyContourDensity(9, 3)).toBe(3);
  });

  it("returns non-positive / non-finite base intervals unchanged so the caller's no-contours guard still fires", () => {
    expect(applyContourDensity(0, 2)).toBe(0);
    expect(applyContourDensity(-5, 3)).toBe(-5);
    expect(applyContourDensity(NaN, 2)).toBeNaN();
    expect(applyContourDensity(Infinity, 2)).toBe(Infinity);
  });
});

describe("contourIntervalToMetres", () => {
  it("metric passes through unchanged", () => {
    expect(contourIntervalToMetres(10, "metric")).toBe(10);
  });

  it("nautical converts fathoms → metres (×1.8288), matching OverviewMap", () => {
    expect(contourIntervalToMetres(10, "nautical")).toBeCloseTo(18.288, 6);
  });

  it("imperial converts feet → metres (÷3.28084), matching OverviewMap", () => {
    expect(contourIntervalToMetres(10, "imperial")).toBeCloseTo(3.048, 3);
  });
});

describe("isIndexContourDepth", () => {
  it("flags every 5th level as an index contour", () => {
    const interval = 2; // effective interval in metres
    // Levels: 2,4,6,8,10,12,... → index levels are multiples of 10.
    expect(isIndexContourDepth(10, interval)).toBe(true);
    expect(isIndexContourDepth(20, interval)).toBe(true);
    expect(isIndexContourDepth(2, interval)).toBe(false);
    expect(isIndexContourDepth(4, interval)).toBe(false);
    expect(isIndexContourDepth(12, interval)).toBe(false);
    expect(INDEX_CONTOUR_EVERY).toBe(5);
  });

  it("depth 0 counts as an index level (multiple of anything)", () => {
    expect(isIndexContourDepth(0, 2)).toBe(true);
  });

  it("tolerates accumulated float error from repeated interval addition", () => {
    // Simulate buildContourLines' isoDepth += interval accumulation with a
    // non-representable interval (10 ft in metres).
    const interval = 10 / 3.28084;
    let depth = 0;
    for (let i = 0; i < 25; i++) depth += interval;
    // 25 levels → multiple of 5 → index contour despite float drift.
    expect(isIndexContourDepth(depth, interval)).toBe(true);

    let nonIndex = 0;
    for (let i = 0; i < 23; i++) nonIndex += interval;
    expect(isIndexContourDepth(nonIndex, interval)).toBe(false);
  });

  it("never classifies with a non-positive or non-finite interval", () => {
    expect(isIndexContourDepth(10, 0)).toBe(false);
    expect(isIndexContourDepth(10, -1)).toBe(false);
    expect(isIndexContourDepth(10, NaN)).toBe(false);
  });
});
