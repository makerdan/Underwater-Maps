/**
 * Unit tests for the gpsRecordingInterval setting guard:
 *  - setGpsRecordingInterval clamps values below 1000 ms to 1000.
 *  - settingsResponseSchema rejects (skips) gpsRecordingInterval < 1000.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";
import { parseSettingsResponse } from "../settingsResponseSchema";

beforeEach(() => {
  useSettingsStore.setState({ gpsRecordingInterval: 10_000 });
});

describe("setGpsRecordingInterval — minimum 1000 ms clamp", () => {
  it("accepts values at or above the 1000 ms floor", () => {
    useSettingsStore.getState().setGpsRecordingInterval(1000);
    expect(useSettingsStore.getState().gpsRecordingInterval).toBe(1000);

    useSettingsStore.getState().setGpsRecordingInterval(5000);
    expect(useSettingsStore.getState().gpsRecordingInterval).toBe(5000);
  });

  it("clamps values below 1000 ms up to 1000 ms", () => {
    useSettingsStore.getState().setGpsRecordingInterval(500);
    expect(useSettingsStore.getState().gpsRecordingInterval).toBe(1000);
  });

  it("clamps 0 to 1000 ms", () => {
    useSettingsStore.getState().setGpsRecordingInterval(0);
    expect(useSettingsStore.getState().gpsRecordingInterval).toBe(1000);
  });

  it("clamps negative values to 1000 ms", () => {
    useSettingsStore.getState().setGpsRecordingInterval(-5000);
    expect(useSettingsStore.getState().gpsRecordingInterval).toBe(1000);
  });
});

describe("parseSettingsResponse — gpsRecordingInterval schema guard", () => {
  it("accepts a valid interval (>= 1000)", () => {
    const result = parseSettingsResponse({ gpsRecordingInterval: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gpsRecordingInterval).toBe(5000);
      expect(result.skippedKeys).not.toContain("gpsRecordingInterval");
    }
  });

  it("skips gpsRecordingInterval when value is below 1000 ms", () => {
    const result = parseSettingsResponse({ gpsRecordingInterval: 500 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gpsRecordingInterval).toBeUndefined();
      expect(result.skippedKeys).toContain("gpsRecordingInterval");
    }
  });

  it("skips gpsRecordingInterval when value is 0", () => {
    const result = parseSettingsResponse({ gpsRecordingInterval: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gpsRecordingInterval).toBeUndefined();
      expect(result.skippedKeys).toContain("gpsRecordingInterval");
    }
  });

  it("skips gpsRecordingInterval when value is negative", () => {
    const result = parseSettingsResponse({ gpsRecordingInterval: -1000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gpsRecordingInterval).toBeUndefined();
      expect(result.skippedKeys).toContain("gpsRecordingInterval");
    }
  });

  it("skips gpsRecordingInterval when value is not a number", () => {
    const result = parseSettingsResponse({ gpsRecordingInterval: "fast" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.gpsRecordingInterval).toBeUndefined();
      expect(result.skippedKeys).toContain("gpsRecordingInterval");
    }
  });
});
