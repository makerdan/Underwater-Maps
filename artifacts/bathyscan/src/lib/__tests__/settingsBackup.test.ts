/**
 * settingsBackup unit tests — export payload scoping and import validation.
 *
 * Regression coverage (Task: settings import/export hardening):
 *   - Non-object top-level values (null, arrays, scalars) are rejected.
 *   - Invalid field values are skipped and reported, never applied.
 *   - Internal sync-metadata keys (syncedSnapshot, lastSyncedAt, _hasHydrated,
 *     schemaVersion, version) are never applied on import.
 *   - Unknown keys are skipped and reported.
 *   - The export payload contains exactly the DEFAULT_SETTINGS keys (minus
 *     lastSyncedAt) plus a version stamp — no internal state, no functions.
 */
import { describe, it, expect } from "vitest";
import {
  buildSettingsExport,
  parseSettingsImport,
  SETTINGS_EXPORT_KEYS,
  SETTINGS_EXPORT_VERSION,
  SETTINGS_IMPORT_DENYLIST,
} from "../settingsBackup";
import { DEFAULT_SETTINGS } from "../settingsStore";

describe("parseSettingsImport — top-level shape", () => {
  it("rejects null", () => {
    const r = parseSettingsImport(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/null/);
  });

  it("rejects arrays", () => {
    const r = parseSettingsImport([1, 2, 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/array/);
  });

  it("rejects scalars", () => {
    for (const v of ["hello", 42, true]) {
      const r = parseSettingsImport(v);
      expect(r.ok).toBe(false);
    }
  });

  it("accepts an empty object (nothing to apply, nothing skipped)", () => {
    const r = parseSettingsImport({});
    expect(r).toEqual({ ok: true, settings: {}, skippedKeys: [] });
  });
});

describe("parseSettingsImport — field validation", () => {
  it("applies valid fields and skips invalid ones with a report", () => {
    const r = parseSettingsImport({
      hudOpacity: 0.5, // valid number
      invertMouseY: "yes-please", // invalid: string where boolean expected
      colormapTheme: "neon-lava", // invalid enum value
      units: "metric", // valid enum
      visibleMarkerTypes: [1, 2, 3], // invalid: numbers where strings expected
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toEqual({ hudOpacity: 0.5, units: "metric" });
    expect(r.skippedKeys.sort()).toEqual(
      ["colormapTheme", "invertMouseY", "visibleMarkerTypes"].sort(),
    );
  });

  it("skips arrays where scalars are expected and out-of-type numbers", () => {
    const r = parseSettingsImport({ fieldOfView: ["not", "a", "number"], fogColor: 42 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toEqual({});
    expect(r.skippedKeys.sort()).toEqual(["fieldOfView", "fogColor"]);
  });

  it("accepts nullable fields with explicit null", () => {
    const r = parseSettingsImport({ lastSession: null, defaultMapLoad: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toEqual({ lastSession: null, defaultMapLoad: null });
    expect(r.skippedKeys).toEqual([]);
  });

  it("reports unknown keys as skipped and never applies them", () => {
    const r = parseSettingsImport({ totallyMadeUpKey: 1, hudOpacity: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toEqual({ hudOpacity: 1 });
    expect(r.skippedKeys).toEqual(["totallyMadeUpKey"]);
  });
});

describe("parseSettingsImport — internal-key denylist", () => {
  it("silently drops every denylisted internal key, valid-looking or not", () => {
    const r = parseSettingsImport({
      syncedSnapshot: { hudOpacity: 1 },
      lastSyncedAt: "2020-01-01T00:00:00Z",
      _hasHydrated: true,
      schemaVersion: 1,
      version: 99,
      hudOpacity: 0.9,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings).toEqual({ hudOpacity: 0.9 });
    // Denylisted keys are excluded silently — not applied AND not warned.
    expect(r.skippedKeys).toEqual([]);
  });

  it("denylist covers all documented internal keys", () => {
    for (const key of ["syncedSnapshot", "lastSyncedAt", "_hasHydrated", "schemaVersion", "version"]) {
      expect(SETTINGS_IMPORT_DENYLIST.has(key)).toBe(true);
    }
  });

  it("round-trip: importing a fresh export never touches sync metadata", () => {
    const exported = buildSettingsExport(DEFAULT_SETTINGS);
    const r = parseSettingsImport(exported);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("syncedSnapshot" in r.settings).toBe(false);
    expect("lastSyncedAt" in r.settings).toBe(false);
    expect("schemaVersion" in r.settings).toBe(false);
    expect(r.skippedKeys).toEqual([]);
  });
});

describe("buildSettingsExport", () => {
  it("contains exactly the DEFAULT_SETTINGS keys (minus lastSyncedAt) plus version", () => {
    const exported = buildSettingsExport(DEFAULT_SETTINGS);
    const keys = Object.keys(exported).sort();
    const expected = [...SETTINGS_EXPORT_KEYS.map(String), "version"].sort();
    expect(keys).toEqual(expected);
    expect(exported.version).toBe(SETTINGS_EXPORT_VERSION);
    expect("lastSyncedAt" in exported).toBe(false);
    expect("syncedSnapshot" in exported).toBe(false);
  });

  it("never serializes internal metadata or action functions from a live store state", () => {
    const fakeStoreState = {
      ...DEFAULT_SETTINGS,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      syncedSnapshot: { hudOpacity: 1 },
      _hasHydrated: true,
      setHudOpacity: () => undefined,
      hydrateFromServer: () => undefined,
    };
    const exported = buildSettingsExport(fakeStoreState);
    expect("lastSyncedAt" in exported).toBe(false);
    expect("syncedSnapshot" in exported).toBe(false);
    expect("_hasHydrated" in exported).toBe(false);
    expect(Object.values(exported).some((v) => typeof v === "function")).toBe(false);
    // JSON-serializable end to end
    expect(() => JSON.stringify(exported)).not.toThrow();
  });

  it("reads live values from the passed state, falling back to defaults for missing keys", () => {
    const exported = buildSettingsExport({ hudOpacity: 0.33 });
    expect(exported.hudOpacity).toBe(0.33);
    expect(exported.units).toBe(DEFAULT_SETTINGS.units);
  });
});
