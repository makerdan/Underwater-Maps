/**
 * units helpers — conversion + formatting behaviour for metric/imperial.
 *
 * Covers the four public formatters (depth, distance, speed, temperature),
 * their null/NaN guards, and that they read the live preference from the
 * settings store when no explicit `units` option is provided.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  formatDepth,
  formatDistance,
  formatSpeed,
  formatTemperature,
  depthSuffix,
  distanceLargeSuffix,
  getUnits,
} from "@/lib/units";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/lib/settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
});

describe("formatDepth", () => {
  it("returns the em-dash for null, undefined and non-finite input", () => {
    expect(formatDepth(null)).toBe("—");
    expect(formatDepth(undefined)).toBe("—");
    expect(formatDepth(Number.NaN)).toBe("—");
    expect(formatDepth(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats metres with an 'm' suffix in metric mode", () => {
    expect(formatDepth(123, { units: "metric" })).toBe("123 m");
    expect(formatDepth(123.4, { units: "metric" })).toBe("123 m");
    expect(formatDepth(123.4, { units: "metric", decimals: 1 })).toBe("123.4 m");
  });

  it("converts metres → feet with an 'ft' suffix in imperial mode", () => {
    // 100 m × 3.28084 ≈ 328.084 → 328 ft (default decimals = 0)
    expect(formatDepth(100, { units: "imperial" })).toBe("328 ft");
    expect(formatDepth(100, { units: "imperial", decimals: 1 })).toBe("328.1 ft");
  });

  it("falls back to the live store preference when no override is given", () => {
    useSettingsStore.getState().setUnits("imperial");
    expect(getUnits()).toBe("imperial");
    expect(formatDepth(10)).toBe("33 ft");

    useSettingsStore.getState().setUnits("metric");
    expect(formatDepth(10)).toBe("10 m");
  });
});

describe("formatDistance", () => {
  it("guards null / NaN", () => {
    expect(formatDistance(null)).toBe("—");
    expect(formatDistance(Number.NaN)).toBe("—");
  });

  it("uses metres under 1 km and km above in metric mode", () => {
    expect(formatDistance(500, { units: "metric" })).toBe("500 m");
    expect(formatDistance(1500, { units: "metric" })).toBe("1.50 km");
    expect(formatDistance(25000, { units: "metric" })).toBe("25 km");
  });

  it("uses feet under 1000 ft and miles above in imperial mode", () => {
    // 100 m ≈ 328 ft → still feet
    expect(formatDistance(100, { units: "imperial" })).toBe("328 ft");
    // 1500 m ≈ 4921 ft → switches to miles (~0.93 mi)
    expect(formatDistance(1500, { units: "imperial" })).toBe("0.93 mi");
    // 25 km ≈ 15.53 mi → ≥10 mi rounds to whole miles
    expect(formatDistance(25000, { units: "imperial" })).toBe("16 mi");
  });
});

describe("formatSpeed", () => {
  it("guards null / NaN", () => {
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(Number.NaN)).toBe("—");
  });

  it("keeps mph in imperial mode", () => {
    expect(formatSpeed(10, { units: "imperial" })).toBe("10 mph");
    expect(formatSpeed(12.5, { units: "imperial" })).toBe("12.5 mph");
  });

  it("converts mph → km/h in metric mode", () => {
    // 10 mph × 1.609344 = 16.09344 → 16.1 km/h
    expect(formatSpeed(10, { units: "metric" })).toBe("16.1 km/h");
    expect(formatSpeed(10, { units: "metric", decimals: 2 })).toBe("16.09 km/h");
  });
});

describe("formatTemperature", () => {
  it("guards null / NaN", () => {
    expect(formatTemperature(null)).toBe("—");
    expect(formatTemperature(Number.NaN)).toBe("—");
  });

  it("formats °C in metric mode", () => {
    expect(formatTemperature(20, { units: "metric" })).toBe("20.0 °C");
    expect(formatTemperature(20.456, { units: "metric", decimals: 2 })).toBe("20.46 °C");
  });

  it("converts °C → °F in imperial mode", () => {
    expect(formatTemperature(0, { units: "imperial" })).toBe("32.0 °F");
    expect(formatTemperature(100, { units: "imperial" })).toBe("212.0 °F");
    expect(formatTemperature(-40, { units: "imperial" })).toBe("-40.0 °F");
  });
});

describe("suffix helpers", () => {
  it("depthSuffix and distanceLargeSuffix follow the units preference", () => {
    expect(depthSuffix("metric")).toBe("m");
    expect(depthSuffix("imperial")).toBe("ft");
    expect(distanceLargeSuffix("metric")).toBe("km");
    expect(distanceLargeSuffix("imperial")).toBe("mi");
  });
});
