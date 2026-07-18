/**
 * Regression tests for the settingsStore Zustand persist migration.
 *
 * Coverage:
 *   1. Removed keys (`showSpeedIndicator`, `conditionsOverlayStyle`,
 *      `crosshairMenuKey`, `defaultNavMode`) are absent from the live
 *      store state after hydrating an old snapshot.
 *   2. `conditionsOverlayStyle: "arrows"` is split into the three
 *      independent per-overlay style keys during migration.
 *   3. `crosshairMenuKey` is merged into the `keyBindings` map as
 *      `crosshairMenu` and the top-level key is dropped.
 *   4. `largeHudText: true` → `globalFontSize: "large"` promotion.
 *   5. `largeHudText: false` (or absent) → `globalFontSize: "medium"`.
 *   6. `cameraSpawnBehaviour: "deepest"` is migrated to `"last"`.
 *   7. A current-version snapshot passes through without losing keys.
 *   8. DEFAULT_SETTINGS keys are present after migrating a minimal snapshot.
 *
 * Pattern: inject a synthetic localStorage entry then call
 * `useSettingsStore.persist.rehydrate()` to exercise the migrate callback,
 * then read the live store state. Matches the established pattern from
 * paletteStore.test.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore, SETTINGS_SCHEMA_VERSION } from "../lib/settingsStore";

type AnyRecord = Record<string, unknown>;

const STORE_KEY = "bathyscan:settings";

function setPersistedState(snapshot: AnyRecord, version = 0) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ state: snapshot, version }));
}

async function rehydrate(snapshot: AnyRecord, version = 0): Promise<AnyRecord> {
  setPersistedState(snapshot, version);
  await useSettingsStore.persist.rehydrate();
  return useSettingsStore.getState() as unknown as AnyRecord;
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useSettingsStore.getState().resetAll();
});

// ---------------------------------------------------------------------------
// Orphaned key removal
// ---------------------------------------------------------------------------

describe("settingsStore migration — orphaned keys are absent after hydration", () => {
  it("showSpeedIndicator (removed in v7→v8) is not present in migrated state", async () => {
    const result = await rehydrate({ showSpeedIndicator: true, units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "showSpeedIndicator")).toBe(false);
  });

  it("conditionsOverlayStyle (removed in v5→v6) is not present in migrated state", async () => {
    const result = await rehydrate({ conditionsOverlayStyle: "arrows", units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "conditionsOverlayStyle")).toBe(false);
  });

  it("crosshairMenuKey (removed in v8→v9) is not present in migrated state", async () => {
    const result = await rehydrate({ crosshairMenuKey: "q", units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "crosshairMenuKey")).toBe(false);
  });

  it("defaultNavMode (removed in v9→v10) is not present in migrated state", async () => {
    const result = await rehydrate({ defaultNavMode: "orbit", units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "defaultNavMode")).toBe(false);
  });

  it("all four removed keys are absent simultaneously in a combined old snapshot", async () => {
    const result = await rehydrate({
      showSpeedIndicator: true,
      conditionsOverlayStyle: "particles",
      crosshairMenuKey: "q",
      defaultNavMode: "orbit",
      units: "imperial",
    });
    expect(Object.prototype.hasOwnProperty.call(result, "showSpeedIndicator")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "conditionsOverlayStyle")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "crosshairMenuKey")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "defaultNavMode")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// conditionsOverlayStyle split
// ---------------------------------------------------------------------------

describe("settingsStore migration — conditionsOverlayStyle → per-overlay style keys", () => {
  it("conditionsOverlayStyle=arrows → windOverlayStyle / tideOverlayStyle / currentOverlayStyle = 'arrows'", async () => {
    const result = await rehydrate({ conditionsOverlayStyle: "arrows" });
    expect(result["windOverlayStyle"]).toBe("arrows");
    expect(result["tideOverlayStyle"]).toBe("arrows");
    expect(result["currentOverlayStyle"]).toBe("arrows");
  });

  it("conditionsOverlayStyle=particles → all three per-overlay keys = 'particles'", async () => {
    const result = await rehydrate({ conditionsOverlayStyle: "particles" });
    expect(result["windOverlayStyle"]).toBe("particles");
    expect(result["tideOverlayStyle"]).toBe("particles");
    expect(result["currentOverlayStyle"]).toBe("particles");
  });

  it("absent conditionsOverlayStyle → per-overlay keys fall back to defaults (string values)", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(typeof result["windOverlayStyle"]).toBe("string");
    expect(typeof result["tideOverlayStyle"]).toBe("string");
    expect(typeof result["currentOverlayStyle"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// crosshairMenuKey → keyBindings promotion
// ---------------------------------------------------------------------------

describe("settingsStore migration — crosshairMenuKey promoted to keyBindings.crosshairMenu", () => {
  it("crosshairMenuKey is moved into keyBindings.crosshairMenu", async () => {
    const result = await rehydrate({ crosshairMenuKey: "e", units: "metric" });
    const bindings = result["keyBindings"] as AnyRecord;
    expect(bindings["crosshairMenu"]).toBe("e");
  });
});

// ---------------------------------------------------------------------------
// largeHudText → globalFontSize promotion
// ---------------------------------------------------------------------------

describe("settingsStore migration — largeHudText → globalFontSize", () => {
  it("largeHudText=true → globalFontSize='large'", async () => {
    const result = await rehydrate({ largeHudText: true, units: "metric" });
    expect(result["globalFontSize"]).toBe("large");
  });

  it("largeHudText=false → globalFontSize='medium'", async () => {
    const result = await rehydrate({ largeHudText: false, units: "metric" });
    expect(result["globalFontSize"]).toBe("medium");
  });

  it("absent largeHudText → globalFontSize='medium'", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(result["globalFontSize"]).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// cameraSpawnBehaviour migration
// ---------------------------------------------------------------------------

describe("settingsStore migration — cameraSpawnBehaviour 'deepest' → 'last'", () => {
  it("cameraSpawnBehaviour='deepest' is migrated to 'last'", async () => {
    const result = await rehydrate({ cameraSpawnBehaviour: "deepest", units: "metric" });
    expect(result["cameraSpawnBehaviour"]).toBe("last");
  });

  it("cameraSpawnBehaviour='home' is preserved unchanged", async () => {
    const result = await rehydrate({ cameraSpawnBehaviour: "home", units: "metric" });
    expect(result["cameraSpawnBehaviour"]).toBe("home");
  });

  it("absent cameraSpawnBehaviour defaults to 'last'", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(result["cameraSpawnBehaviour"]).toBe("last");
  });
});

// ---------------------------------------------------------------------------
// Current-version pass-through — user preferences are preserved
// ---------------------------------------------------------------------------

describe("settingsStore migration — current-version snapshot preserves user preferences", () => {
  it("a snapshot already at SETTINGS_SCHEMA_VERSION keeps its 'units' value", async () => {
    const result = await rehydrate(
      { units: "nautical", schemaVersion: SETTINGS_SCHEMA_VERSION, keyBindings: {} },
      SETTINGS_SCHEMA_VERSION,
    );
    expect(result["units"]).toBe("nautical");
  });

  it("v23→v24: legacy terrainExaggeration 0.8 is clamped up to the 1× slider minimum", async () => {
    const result = await rehydrate({ terrainExaggeration: 0.8, keyBindings: {} });
    expect(result["terrainExaggeration"]).toBe(1);
  });

  it("in-range terrainExaggeration is preserved; out-of-range is clamped during migration", async () => {
    const kept = await rehydrate({ terrainExaggeration: 5, keyBindings: {} });
    expect(kept["terrainExaggeration"]).toBe(5);
    const clamped = await rehydrate({ terrainExaggeration: 99, keyBindings: {} });
    expect(clamped["terrainExaggeration"]).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// v14 → v15: independent overlay toggle keys injected for existing users
//
// These keys were previously held only in transient uiStore / localStorage.
// When v14→v15 migration runs, any key absent from the stored state must
// be seeded from DEFAULT_SETTINGS so existing users' overlays aren't broken.
// ---------------------------------------------------------------------------

describe("settingsStore migration — v14→v15 overlay toggle keys are present after hydration", () => {
  it("windOverlayActive is present after migrating a pre-v14 snapshot", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "windOverlayActive")).toBe(true);
    expect(typeof result["windOverlayActive"]).toBe("boolean");
  });

  it("tideOverlayActive is present after migrating a pre-v14 snapshot", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "tideOverlayActive")).toBe(true);
    expect(typeof result["tideOverlayActive"]).toBe("boolean");
  });

  it("currentOverlayActive is present after migrating a pre-v14 snapshot", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "currentOverlayActive")).toBe(true);
    expect(typeof result["currentOverlayActive"]).toBe("boolean");
  });

  it("weatherStationsActive is present after migrating a pre-v14 snapshot", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "weatherStationsActive")).toBe(true);
    expect(typeof result["weatherStationsActive"]).toBe("boolean");
  });

  it("efhOverlayEnabled is present after migrating a pre-v14 snapshot", async () => {
    const result = await rehydrate({ units: "metric" });
    expect(Object.prototype.hasOwnProperty.call(result, "efhOverlayEnabled")).toBe(true);
    expect(typeof result["efhOverlayEnabled"]).toBe("boolean");
  });

  it("an explicit pre-v14 windOverlayActive=true is preserved, not overwritten by migration", async () => {
    const result = await rehydrate({ units: "metric", windOverlayActive: true });
    expect(result["windOverlayActive"]).toBe(true);
  });

  it("an explicit pre-v14 windOverlayActive=false is preserved, not overwritten by migration", async () => {
    const result = await rehydrate({ units: "metric", windOverlayActive: false });
    expect(result["windOverlayActive"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Minimal snapshot gets DEFAULT_SETTINGS keys
// ---------------------------------------------------------------------------

describe("settingsStore migration — minimal empty snapshot gets all required defaults", () => {
  it("migrated state has a 'units' key of type string", async () => {
    const result = await rehydrate({});
    expect(typeof result["units"]).toBe("string");
  });

  it("migrated state has a 'colormapTheme' key of type string", async () => {
    const result = await rehydrate({});
    expect(typeof result["colormapTheme"]).toBe("string");
  });

  it("migrated state schemaVersion equals SETTINGS_SCHEMA_VERSION", async () => {
    const result = await rehydrate({});
    expect(result["schemaVersion"]).toBe(SETTINGS_SCHEMA_VERSION);
  });
});
