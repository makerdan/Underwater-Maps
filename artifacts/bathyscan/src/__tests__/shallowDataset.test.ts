import { describe, it, expect } from "vitest";
import {
  SHALLOW_RANGE_METRES,
  SHALLOW_SUGGESTED_EXAGGERATION,
  isShallowDataset,
  fineContourIntervalFor,
  fineContourIntervalLabel,
} from "../lib/shallowDataset";

describe("isShallowDataset — threshold behaviour", () => {
  it("threshold constant equals 20 ft in metres", () => {
    expect(SHALLOW_RANGE_METRES).toBeCloseTo(6.096, 3);
  });

  it("returns true for a range clearly under the threshold (0–3 m)", () => {
    expect(isShallowDataset(0, 3)).toBe(true);
  });

  it("returns true just below the threshold", () => {
    expect(isShallowDataset(0, 6.09)).toBe(true);
  });

  it("returns false exactly at the threshold", () => {
    expect(isShallowDataset(0, SHALLOW_RANGE_METRES)).toBe(false);
  });

  it("returns false above the threshold", () => {
    expect(isShallowDataset(0, 6.5)).toBe(false);
    expect(isShallowDataset(0, 100)).toBe(false);
  });

  it("uses the RANGE, not absolute depth — deep but flat-range dataset is shallow", () => {
    expect(isShallowDataset(100, 104)).toBe(true);
  });

  it("returns false for zero range", () => {
    expect(isShallowDataset(5, 5)).toBe(false);
  });

  it("returns false for negative range", () => {
    expect(isShallowDataset(10, 5)).toBe(false);
  });

  it("returns false for non-finite inputs", () => {
    expect(isShallowDataset(0, NaN)).toBe(false);
    expect(isShallowDataset(NaN, 3)).toBe(false);
    expect(isShallowDataset(0, Infinity)).toBe(false);
  });
});

describe("shallow suggestion values", () => {
  it("suggested exaggeration is 5×", () => {
    expect(SHALLOW_SUGGESTED_EXAGGERATION).toBe(5);
  });

  it("fine contour interval: 0.5 for metric, 1 for imperial, 0.5 for nautical", () => {
    expect(fineContourIntervalFor("metric")).toBe(0.5);
    expect(fineContourIntervalFor("imperial")).toBe(1);
    expect(fineContourIntervalFor("nautical")).toBe(0.5);
  });

  it("labels match values", () => {
    expect(fineContourIntervalLabel("metric")).toBe("0.5 m");
    expect(fineContourIntervalLabel("imperial")).toBe("1 ft");
    expect(fineContourIntervalLabel("nautical")).toBe("0.5 fm");
  });
});
