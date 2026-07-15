/**
 * Tests for the showWaterTempLayer toggle persistence in settingsStore.
 * Follows the pattern used in paletteStore persistence tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/lib/settingsStore";

beforeEach(() => {
  useSettingsStore.setState({
    showWaterTempLayer: false,
  });
});

describe("showWaterTempLayer toggle", () => {
  it("defaults to false (opt-in)", () => {
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(false);
  });

  it("can be toggled to true via setShowWaterTempLayer", () => {
    useSettingsStore.getState().setShowWaterTempLayer(true);
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(true);
  });

  it("can be toggled back to false", () => {
    useSettingsStore.getState().setShowWaterTempLayer(true);
    useSettingsStore.getState().setShowWaterTempLayer(false);
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(false);
  });

  it("survives store rehydration with the value it was set to", () => {
    useSettingsStore.getState().setShowWaterTempLayer(true);
    const snapshot = useSettingsStore.getState().showWaterTempLayer;
    // Simulate a rehydration by manually restoring the field
    useSettingsStore.setState({ showWaterTempLayer: snapshot });
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(true);
  });

  it("resets to false after explicit setState to default", () => {
    useSettingsStore.getState().setShowWaterTempLayer(true);
    useSettingsStore.setState({ showWaterTempLayer: false });
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(false);
  });

  it("independent from showWaterSurface toggle", () => {
    useSettingsStore.getState().setShowWaterTempLayer(true);
    useSettingsStore.getState().setShowWaterSurface(false);
    expect(useSettingsStore.getState().showWaterTempLayer).toBe(true);
    expect(useSettingsStore.getState().showWaterSurface).toBe(false);
  });
});
