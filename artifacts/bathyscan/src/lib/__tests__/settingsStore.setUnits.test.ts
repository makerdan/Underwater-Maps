/**
 * setUnits depth-unit override preservation (Task: settings data correctness).
 *
 * DepthUnit has no "auto" sentinel, so an "explicit override" is defined as a
 * depthUnit that diverges from the current units system's derived default
 * (metric → metres, imperial/nautical → feet). setUnits must:
 *   - follow the new units when the user has NOT overridden depth, and
 *   - leave depthUnit untouched when the user HAS overridden it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, DEFAULT_SETTINGS } from "../settingsStore";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({
    ...useSettingsStore.getState(),
    ...DEFAULT_SETTINGS,
    units: "metric",
    depthUnit: "metres",
  });
});

describe("setUnits — depth unit follows units when not overridden", () => {
  it("metric → imperial updates depth to feet", () => {
    useSettingsStore.getState().setUnits("imperial");
    expect(useSettingsStore.getState().units).toBe("imperial");
    expect(useSettingsStore.getState().depthUnit).toBe("feet");
  });

  it("metric → nautical updates depth to feet", () => {
    useSettingsStore.getState().setUnits("nautical");
    expect(useSettingsStore.getState().depthUnit).toBe("feet");
  });

  it("imperial (depth feet) → metric updates depth to metres", () => {
    useSettingsStore.setState({ units: "imperial", depthUnit: "feet" });
    useSettingsStore.getState().setUnits("metric");
    expect(useSettingsStore.getState().depthUnit).toBe("metres");
  });
});

describe("setUnits — explicit depth override is preserved", () => {
  it("keeps a metres override when switching imperial → nautical", () => {
    // User on imperial explicitly chose metres (diverges from derived feet).
    useSettingsStore.setState({ units: "imperial", depthUnit: "metres" });
    useSettingsStore.getState().setUnits("nautical");
    expect(useSettingsStore.getState().units).toBe("nautical");
    expect(useSettingsStore.getState().depthUnit).toBe("metres");
  });

  it("keeps a feet override when switching metric → nautical", () => {
    // User on metric explicitly chose feet (diverges from derived metres).
    useSettingsStore.setState({ units: "metric", depthUnit: "feet" });
    useSettingsStore.getState().setUnits("nautical");
    expect(useSettingsStore.getState().depthUnit).toBe("feet");
  });

  it("keeps a feet override when switching metric → imperial (override happens to match new derived)", () => {
    useSettingsStore.setState({ units: "metric", depthUnit: "feet" });
    useSettingsStore.getState().setUnits("imperial");
    expect(useSettingsStore.getState().depthUnit).toBe("feet");
  });
});
