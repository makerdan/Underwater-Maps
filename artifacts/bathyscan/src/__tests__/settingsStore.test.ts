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
  SECTION_KEYS,
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

  it("terrainExaggeration defaults to 1× (slider minimum) so UI and renderer agree", () => {
    expect(DEFAULT_SETTINGS.terrainExaggeration).toBe(1);
    expect(useSettingsStore.getState().terrainExaggeration).toBe(1);
  });

  it("setTerrainExaggeration clamps into the [1, 20] slider range", () => {
    const s = useSettingsStore.getState();
    s.setTerrainExaggeration(0.5);
    expect(useSettingsStore.getState().terrainExaggeration).toBe(1);
    s.setTerrainExaggeration(25);
    expect(useSettingsStore.getState().terrainExaggeration).toBe(20);
    s.setTerrainExaggeration(5);
    expect(useSettingsStore.getState().terrainExaggeration).toBe(5);
    s.setTerrainExaggeration(Number.NaN);
    expect(useSettingsStore.getState().terrainExaggeration).toBe(1);
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

  it("currents section has all expected defaults and round-trips through resetSection", () => {
    const s = useSettingsStore.getState();
    expect(s.currentsEnabled).toBe(false);
    expect(s.currentsSource).toBe("noaa");
    expect(s.currentsShowParticles).toBe(true);
    expect(s.currentsShowArrows).toBe(true);
    expect(s.currentsShowStreamlines).toBe(false);

    s.setCurrentsEnabled(true);
    s.setCurrentsSource("noaa");
    s.setCurrentsManualSpeedKt(2.5);
    s.setCurrentsTidePhase(0.42);
    s.setCurrentsShowStreamlines(true);
    expect(useSettingsStore.getState().currentsEnabled).toBe(true);
    expect(useSettingsStore.getState().currentsManualSpeedKt).toBe(2.5);
    expect(useSettingsStore.getState().currentsTidePhase).toBe(0.42);

    s.resetSection("currents");
    const after = useSettingsStore.getState();
    expect(after.currentsEnabled).toBe(DEFAULT_SETTINGS.currentsEnabled);
    expect(after.currentsSource).toBe(DEFAULT_SETTINGS.currentsSource);
    expect(after.currentsManualSpeedKt).toBe(DEFAULT_SETTINGS.currentsManualSpeedKt);
    expect(after.currentsTidePhase).toBe(DEFAULT_SETTINGS.currentsTidePhase);
    expect(after.currentsShowStreamlines).toBe(DEFAULT_SETTINGS.currentsShowStreamlines);
  });

  it("hydrateFromServer merges partial server state without clobbering unrelated fields", () => {
    const s = useSettingsStore.getState();
    s.setFieldOfView(72);
    // Treat the local fieldOfView change as already synced so the server
    // hydrate doesn't see it as a pending local edit and overwrite it.
    s.markAllSaved(null);
    s.hydrateFromServer({ hudOpacity: 0.55 } as Partial<typeof DEFAULT_SETTINGS>);
    const after = useSettingsStore.getState();
    expect(after.hudOpacity).toBe(0.55);
    expect(after.fieldOfView).toBe(72);
  });

  it("initial state matches DEFAULT_SETTINGS for every defined key", () => {
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]) {
      expect(state[key]).toEqual(DEFAULT_SETTINGS[key]);
    }
  });

  it("hydrateFromServer refreshes syncedSnapshot for merged fields", () => {
    const s = useSettingsStore.getState();
    s.setFieldOfView(72);
    // Treat the local fieldOfView change as already synced so hydrate is
    // allowed to apply server values.
    s.markAllSaved(null);
    s.hydrateFromServer({ hudOpacity: 0.55 } as Partial<typeof DEFAULT_SETTINGS>);
    const snap = useSettingsStore.getState().syncedSnapshot ?? {};
    // Snapshot reflects the merged state (server value + prior client edit).
    expect(snap.hudOpacity).toBe(0.55);
    expect(snap.fieldOfView).toBe(72);
  });

  it("hydrateFromServer ignores unknown keys in the payload", () => {
    const before = useSettingsStore.getState();
    const beforeFov = before.fieldOfView;
    const beforeHud = before.hudOpacity;
    before.hydrateFromServer({
      hudOpacity: 0.42,
      // Unknown / future server keys must not corrupt known fields or the snapshot.
      somethingUnknown: "boom",
      anotherFake: 999,
    } as unknown as Partial<typeof DEFAULT_SETTINGS>);

    const after = useSettingsStore.getState();
    expect(after.hudOpacity).toBe(0.42);
    expect(after.fieldOfView).toBe(beforeFov);
    expect(beforeHud).not.toBe(0.42);

    // Unknown keys must not be applied to store state.
    const stateAsRecord = after as unknown as Record<string, unknown>;
    expect(stateAsRecord.somethingUnknown).toBeUndefined();
    expect(stateAsRecord.anotherFake).toBeUndefined();

    const snap = after.syncedSnapshot ?? {};
    expect(snap).not.toHaveProperty("somethingUnknown");
    expect(snap).not.toHaveProperty("anotherFake");
    // Snapshot only contains known DEFAULT_SETTINGS keys.
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const k of Object.keys(snap)) {
      expect(allowed.has(k)).toBe(true);
    }
  });

  it("persists under the localStorage key 'bathyscan:settings'", async () => {
    useSettingsStore.getState().setFieldOfView(81);
    // Zustand's persist middleware writes asynchronously; flush microtasks.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    const raw = localStorage.getItem("bathyscan:settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.fieldOfView).toBe(81);
  });

  it("hydrateFromServer applies server fields when local has never synced", () => {
    // lastSyncedAt is null on a fresh install — server is authoritative
    // for any field the user hasn't already edited.
    // Reset baseline so this field has no local edit relative to snapshot.
    useSettingsStore.getState().markAllSaved(null);
    useSettingsStore.getState().hydrateFromServer({
      hudOpacity: 0.33,
      __updatedAt: "2026-05-02T10:00:00.000Z",
    } as Partial<typeof DEFAULT_SETTINGS>);
    const after = useSettingsStore.getState();
    expect(after.hudOpacity).toBe(0.33);
    expect(after.lastSyncedAt).toBe("2026-05-02T10:00:00.000Z");
  });

  it("hydrateFromServer: when server is newer than lastSyncedAt, server wins for every field", () => {
    // Establish a sync baseline at an older timestamp.
    useSettingsStore.getState().markAllSaved("2026-04-01T00:00:00.000Z");
    // User locally tweaks fieldOfView after the baseline.
    useSettingsStore.getState().setFieldOfView(99);

    // Server (different device) sent a newer payload changing both fields.
    useSettingsStore.getState().hydrateFromServer({
      fieldOfView: 30,
      hudOpacity: 0.7,
      __updatedAt: "2026-05-01T12:00:00.000Z",
    } as Partial<typeof DEFAULT_SETTINGS>);

    const after = useSettingsStore.getState();
    // Server is newer → server wins, even over an unsynced local edit.
    expect(after.fieldOfView).toBe(30);
    expect(after.hudOpacity).toBe(0.7);
    expect(after.lastSyncedAt).toBe("2026-05-01T12:00:00.000Z");
  });

  it("hydrateFromServer skips application when server is not newer than lastSyncedAt", () => {
    useSettingsStore.setState({
      lastSyncedAt: "2026-05-10T00:00:00.000Z",
      hudOpacity: 0.5,
    });
    useSettingsStore.getState().hydrateFromServer({
      hudOpacity: 0.9,
      __updatedAt: "2026-05-01T00:00:00.000Z",
    } as Partial<typeof DEFAULT_SETTINGS>);
    const after = useSettingsStore.getState();
    // Server timestamp is older — value must not overwrite local.
    expect(after.hudOpacity).toBe(0.5);
  });

  it("markAllSaved stamps lastSyncedAt to now by default", () => {
    const before = Date.now();
    useSettingsStore.getState().markAllSaved();
    const stamped = useSettingsStore.getState().lastSyncedAt;
    expect(stamped).not.toBeNull();
    const ts = Date.parse(stamped as string);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it("defaultMapLoad is included in SECTION_KEYS['data']", () => {
    expect(SECTION_KEYS["data"]).toContain("defaultMapLoad");
  });

  it("defaultMapLoad defaults to null in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.defaultMapLoad).toBeNull();
    expect(useSettingsStore.getState().defaultMapLoad).toBeNull();
  });

  describe("clearForSignOut", () => {
    it("resets all settings to DEFAULT_SETTINGS including datasetHomePositions", () => {
      const s = useSettingsStore.getState();
      s.setFieldOfView(95);
      s.setHudOpacity(0.3);
      s.setDatasetHome("ds-1", { lon: 1, lat: 2, depth: 3 });

      s.clearForSignOut();

      const after = useSettingsStore.getState();
      expect(after.fieldOfView).toBe(DEFAULT_SETTINGS.fieldOfView);
      expect(after.hudOpacity).toBe(DEFAULT_SETTINGS.hudOpacity);
      // Unlike resetAll, clearForSignOut also clears per-dataset positions
      expect(after.datasetHomePositions).toEqual(DEFAULT_SETTINGS.datasetHomePositions);
    });

    it("clears lastSyncedAt and syncedSnapshot", () => {
      useSettingsStore.getState().markAllSaved("2026-05-01T00:00:00.000Z");
      expect(useSettingsStore.getState().lastSyncedAt).not.toBeNull();

      useSettingsStore.getState().clearForSignOut();

      const after = useSettingsStore.getState();
      expect(after.lastSyncedAt).toBeNull();
      expect(after.syncedSnapshot).toBeUndefined();
    });

    it("removes the bathyscan:settings localStorage entry", async () => {
      useSettingsStore.getState().setFieldOfView(88);
      // Flush Zustand's async persist write.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      // Entry should exist before sign-out.
      expect(localStorage.getItem("bathyscan:settings")).not.toBeNull();

      useSettingsStore.getState().clearForSignOut();

      expect(localStorage.getItem("bathyscan:settings")).toBeNull();
    });

    it("sign-out then hydrateFromServer applies fresh server values (no stale local interference)", () => {
      // Simulate a user who had custom settings and a sync timestamp.
      useSettingsStore.getState().setFieldOfView(99);
      useSettingsStore.getState().markAllSaved("2026-05-01T00:00:00.000Z");

      // Sign-out clears everything.
      useSettingsStore.getState().clearForSignOut();

      // Simulate the next user signing in and the server returning their settings.
      useSettingsStore.getState().hydrateFromServer({
        fieldOfView: 55,
        hudOpacity: 0.6,
        __updatedAt: "2026-05-10T12:00:00.000Z",
      } as Partial<typeof DEFAULT_SETTINGS>);

      const after = useSettingsStore.getState();
      // Server values are applied cleanly — previous user's fieldOfView (99) is gone.
      expect(after.fieldOfView).toBe(55);
      expect(after.hudOpacity).toBe(0.6);
      expect(after.lastSyncedAt).toBe("2026-05-10T12:00:00.000Z");
    });
  });
});
