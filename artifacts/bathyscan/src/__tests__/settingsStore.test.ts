/**
 * settingsStore unit tests — covers schema version, advanced toggle,
 * quality presets, section/global resets, and dataset home helpers.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  useSettingsStore,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  QUALITY_PRESETS,
} from "@/lib/settingsStore";

function resetStore() {
  // Clear any persisted localStorage state and rehydrate to defaults.
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.setState({ ...useSettingsStore.getState(), ...DEFAULT_SETTINGS });
}

describe("settingsStore", () => {
  beforeEach(() => resetStore());

  it("exposes a schema version on the default state", () => {
    expect(useSettingsStore.getState().schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("toggles showAdvancedEverywhere", () => {
    useSettingsStore.getState().setShowAdvancedEverywhere(true);
    expect(useSettingsStore.getState().showAdvancedEverywhere).toBe(true);
  });

  it("applyQualityPreset overwrites visual fields and sets preset name", () => {
    useSettingsStore.getState().applyQualityPreset("ultra");
    const s = useSettingsStore.getState();
    expect(s.qualityPreset).toBe("ultra");
    expect(s.lampIntensity).toBe(QUALITY_PRESETS.ultra.lampIntensity);
    expect(s.fogDensity).toBe(QUALITY_PRESETS.ultra.fogDensity);
    expect(s.antialiasing).toBe(QUALITY_PRESETS.ultra.antialiasing);
  });

  it("mutating an advanced visual knob switches preset to 'custom'", () => {
    useSettingsStore.getState().applyQualityPreset("low");
    expect(useSettingsStore.getState().qualityPreset).toBe("low");
    useSettingsStore.getState().setFogDensity(0.02);
    expect(useSettingsStore.getState().qualityPreset).toBe("custom");
  });

  it("resetSection restores only that section's fields", () => {
    const s = useSettingsStore.getState();
    s.setFieldOfView(95);
    s.setHudOpacity(0.4);
    expect(useSettingsStore.getState().fieldOfView).toBe(95);
    expect(useSettingsStore.getState().hudOpacity).toBe(0.4);

    s.resetSection("camera");
    expect(useSettingsStore.getState().fieldOfView).toBe(DEFAULT_SETTINGS.fieldOfView);
    // HUD section untouched
    expect(useSettingsStore.getState().hudOpacity).toBe(0.4);
  });

  it("resetAll restores every setting but preserves dataset home positions", () => {
    const s = useSettingsStore.getState();
    s.setFieldOfView(95);
    s.setShowAdvancedEverywhere(true);
    s.setDatasetHome("ds-1", { lon: 1, lat: 2, depth: 3 });

    s.resetAll();
    const after = useSettingsStore.getState();
    expect(after.fieldOfView).toBe(DEFAULT_SETTINGS.fieldOfView);
    expect(after.showAdvancedEverywhere).toBe(false);
    expect(after.datasetHomePositions["ds-1"]).toEqual({ lon: 1, lat: 2, depth: 3 });
  });

  it("setDatasetHome and clearDatasetHome work as expected", () => {
    const s = useSettingsStore.getState();
    s.setDatasetHome("ds-x", { lon: 10, lat: 20, depth: 30 });
    expect(useSettingsStore.getState().datasetHomePositions["ds-x"]).toBeDefined();
    s.clearDatasetHome("ds-x");
    expect(useSettingsStore.getState().datasetHomePositions["ds-x"]).toBeUndefined();
  });

  it("showUiTooltips defaults to true and toggles via its setter", () => {
    expect(useSettingsStore.getState().showUiTooltips).toBe(true);
    useSettingsStore.getState().setShowUiTooltips(false);
    expect(useSettingsStore.getState().showUiTooltips).toBe(false);
    useSettingsStore.getState().setShowUiTooltips(true);
    expect(useSettingsStore.getState().showUiTooltips).toBe(true);
  });

  it("resetSection('hud') restores showUiTooltips along with other HUD fields", () => {
    const s = useSettingsStore.getState();
    s.setShowUiTooltips(false);
    s.setHudOpacity(0.4);
    expect(useSettingsStore.getState().showUiTooltips).toBe(false);
    s.resetSection("hud");
    expect(useSettingsStore.getState().showUiTooltips).toBe(DEFAULT_SETTINGS.showUiTooltips);
    expect(useSettingsStore.getState().hudOpacity).toBe(DEFAULT_SETTINGS.hudOpacity);
  });

  it("hydrateFromServer merges partial server state without clobbering unrelated fields", () => {
    const s = useSettingsStore.getState();
    s.setFieldOfView(72);
    s.hydrateFromServer({ hudOpacity: 0.55 } as Partial<typeof DEFAULT_SETTINGS>);
    const after = useSettingsStore.getState();
    expect(after.hudOpacity).toBe(0.55);
    expect(after.fieldOfView).toBe(72);
  });
});
