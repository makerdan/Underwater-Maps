/**
 * settingsBackup — build/validate the Settings Backup JSON files used by the
 * Account page's "Export settings" / "Import settings" buttons.
 *
 * Export:
 *   The exported file contains ONLY user-facing settings fields (the keys of
 *   `DEFAULT_SETTINGS`, minus sync metadata) plus a `version` field for future
 *   migrations. Internal Zustand state (`syncedSnapshot`, `lastSyncedAt`,
 *   `_hasHydrated`, action functions) is never serialized — importing an old
 *   export must not be able to corrupt the server-sync baseline.
 *
 * Import:
 *   `parseSettingsImport` validates an untrusted parsed-JSON value before any
 *   store mutation:
 *     - The top-level value must be a non-null plain object (arrays, null,
 *       scalars are rejected outright).
 *     - Only allowlisted user-facing settings keys are considered; internal /
 *       sync-metadata keys are silently dropped even when present.
 *     - Each candidate field is validated against its per-field Zod schema
 *       from `settingsResponseSchema`; fields with invalid values are skipped
 *       and reported in `skippedKeys` so the UI can warn the user.
 *     - Unknown keys (not a known setting, not internal) are also reported in
 *       `skippedKeys` and never applied.
 */

import type { z } from "zod";
import { DEFAULT_SETTINGS, type SettingsState } from "./settingsStore";
import { settingsFieldSchemas } from "./settingsResponseSchema";

/** Version stamp written into every export file for future migrations. */
export const SETTINGS_EXPORT_VERSION = 1;

/** Maximum accepted import file size (bytes) — checked before reading. */
export const MAX_IMPORT_FILE_BYTES = 512 * 1024;

/**
 * Internal / sync-metadata keys that must NEVER be applied to the store from
 * an imported file, regardless of validation outcome. `version` is the export
 * file's own stamp; `schemaVersion` is managed by the persist migration and
 * overwriting it from a stale backup would skip migrations.
 */
export const SETTINGS_IMPORT_DENYLIST: ReadonlySet<string> = new Set([
  "syncedSnapshot",
  "lastSyncedAt",
  "_hasHydrated",
  "schemaVersion",
  "version",
]);

/**
 * The keys serialized into an export file: every user-facing settings field
 * from DEFAULT_SETTINGS. Sync metadata (`lastSyncedAt`) is excluded;
 * `schemaVersion` is kept in the export as diagnostic info but is denylisted
 * on import above.
 */
export const SETTINGS_EXPORT_KEYS: readonly (keyof SettingsState)[] = (
  Object.keys(DEFAULT_SETTINGS) as (keyof SettingsState)[]
).filter((k) => k !== "lastSyncedAt");

/**
 * Keys that may be applied to the store on import: the export allowlist minus
 * the denylist.
 */
const IMPORT_ALLOWED_KEYS: ReadonlySet<string> = new Set(
  SETTINGS_EXPORT_KEYS.filter((k) => !SETTINGS_IMPORT_DENYLIST.has(k)),
);

/**
 * Build the JSON-serializable export payload from a settings state object
 * (normally `useSettingsStore.getState()`). Pure: reads only the passed-in
 * state. Keys missing from the state fall back to their defaults so an export
 * is always complete.
 */
export function buildSettingsExport(state: Partial<SettingsState>): Record<string, unknown> {
  const out: Record<string, unknown> = { version: SETTINGS_EXPORT_VERSION };
  for (const key of SETTINGS_EXPORT_KEYS) {
    out[key] = key in state ? (state as Record<string, unknown>)[key] : DEFAULT_SETTINGS[key];
  }
  return out;
}

export type ParseSettingsImportResult =
  | { ok: false; reason: string }
  | { ok: true; settings: Partial<SettingsState>; skippedKeys: string[] };

/**
 * Validate an untrusted parsed-JSON value for import. Never mutates any
 * store — returns the validated partial to apply plus the list of keys that
 * were present but skipped (invalid value or unknown/unsupported key).
 */
export function parseSettingsImport(raw: unknown): ParseSettingsImportResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      reason: `Not a settings backup file (expected an object, got ${
        raw === null ? "null" : Array.isArray(raw) ? "an array" : typeof raw
      })`,
    };
  }

  const rec = raw as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  const skippedKeys: string[] = [];

  for (const key of Object.keys(rec)) {
    // Internal / metadata keys: silently dropped, never applied, never warned.
    if (SETTINGS_IMPORT_DENYLIST.has(key)) continue;

    if (!IMPORT_ALLOWED_KEYS.has(key)) {
      // Unknown key — not a supported setting; warn but never apply.
      skippedKeys.push(key);
      continue;
    }

    const schema = (settingsFieldSchemas as Record<string, z.ZodTypeAny>)[key];
    if (!schema) {
      // Defensive: a DEFAULT_SETTINGS key with no schema entry is skipped
      // rather than applied unvalidated.
      skippedKeys.push(key);
      continue;
    }

    const result = schema.safeParse(rec[key]);
    if (result.success && result.data !== undefined) {
      settings[key] = result.data;
    } else {
      // Present but invalid (the .catch(undefined) guards turn type errors
      // into undefined) — skip and report.
      skippedKeys.push(key);
    }
  }

  return { ok: true, settings: settings as Partial<SettingsState>, skippedKeys };
}
