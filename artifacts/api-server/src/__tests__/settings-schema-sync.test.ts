/**
 * settings-schema-sync.test.ts — schema coverage guard
 *
 * Asserts that every key in DEFAULT_SETTINGS is declared in PutSettingsBody.
 *
 * Why this matters: the settings route silently falls through to the "extras"
 * path for any key that PutSettingsBody does not recognise. If a developer
 * adds a field to DEFAULT_SETTINGS but forgets to add it to the OpenAPI spec
 * (and regenerate PutSettingsBody), that field will never be validated — it
 * will be stored and returned verbatim, bypassing all type/range checks. This
 * test catches that class of drift at commit time rather than in production.
 */

import { describe, it, expect } from "vitest";
import { PutSettingsBody } from "@workspace/api-zod";
import { DEFAULT_SETTINGS } from "../routes/settings.js";

describe("DEFAULT_SETTINGS ↔ PutSettingsBody schema sync", () => {
  const schemaKeys = new Set(Object.keys(PutSettingsBody.shape));
  const defaultKeys = Object.keys(DEFAULT_SETTINGS);

  it("every key in DEFAULT_SETTINGS is validated by PutSettingsBody (no extras-path fallthrough)", () => {
    const missingFromSchema = defaultKeys.filter((k) => !schemaKeys.has(k));
    expect(
      missingFromSchema,
      `The following DEFAULT_SETTINGS keys are absent from PutSettingsBody — ` +
        `add them to the OpenAPI spec and regenerate, or they will bypass validation:\n` +
        missingFromSchema.map((k) => `  • ${k}`).join("\n"),
    ).toEqual([]);
  });

  it("PutSettingsBody has no keys that are missing from DEFAULT_SETTINGS (catches removed fields)", () => {
    const defaultKeySet = new Set(defaultKeys);
    const extraInSchema = [...schemaKeys].filter((k) => !defaultKeySet.has(k));
    expect(
      extraInSchema,
      `The following PutSettingsBody keys have no entry in DEFAULT_SETTINGS — ` +
        `add a default value for each, or clients that omit the field will receive undefined:\n` +
        extraInSchema.map((k) => `  • ${k}`).join("\n"),
    ).toEqual([]);
  });
});

describe("PutSettingsBody accepts the full UI ranges for shallow-dataset polish fields", () => {
  it("terrainExaggeration accepts the slider range [1, 20] and rejects out-of-range values", () => {
    const shape = PutSettingsBody.shape.terrainExaggeration;
    expect(shape.safeParse(1).success).toBe(true);
    expect(shape.safeParse(5).success).toBe(true);
    expect(shape.safeParse(20).success).toBe(true);
    expect(shape.safeParse(0.8).success).toBe(false);
    expect(shape.safeParse(21).success).toBe(false);
  });

  it("contourInterval accepts the fine 0.5 interval and rejects values below it", () => {
    const shape = PutSettingsBody.shape.contourInterval;
    expect(shape.safeParse(0.5).success).toBe(true);
    expect(shape.safeParse(1).success).toBe(true);
    expect(shape.safeParse(1000).success).toBe(true);
    expect(shape.safeParse(0.25).success).toBe(false);
    expect(shape.safeParse(1001).success).toBe(false);
  });
});
