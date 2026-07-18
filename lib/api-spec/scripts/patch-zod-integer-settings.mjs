#!/usr/bin/env node
/**
 * Post-codegen patch: ensures .int() is present on integer-typed settings
 * fields in the generated Zod schema. Orval historically emitted
 * zod.number() for OpenAPI `type: integer` without the .int() refinement,
 * so floats like 1.5 would pass min/max validation. This script runs after
 * orval and inserts .int() between .max(...) and .default(...) for each
 * integer field in the three settings schemas when it is absent.
 *
 * If orval already emits .int() natively (current behaviour), the script
 * verifies the invariant holds and exits 0 without modifying the file.
 *
 * Fields covered: defaultSpeedTier, gpsRecordingInterval,
 * zonePaintBrushRadius, zonePaintSlot.
 * Array-item integer fields: hyd93ActiveFeatureCodes.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..");
const target = resolve(root, "lib", "api-zod", "src", "generated", "api.ts");

const SCHEMAS = [
  "getSettingsResponse",
  "putSettingsBody",
  "putSettingsResponse",
];

const INTEGER_FIELDS = [
  "DefaultSpeedTier",
  "GpsRecordingInterval",
  "ZonePaintBrushRadius",
  "ZonePaintSlot",
  "TripMinDurationH",
];

let src = readFileSync(target, "utf8");
const before = src;
let patchCount = 0;

for (const prefix of SCHEMAS) {
  for (const field of INTEGER_FIELDS) {
    const camelPrefix = prefix.charAt(0).toLowerCase() + prefix.slice(1);
    const varName = `${camelPrefix}${field}`;
    const re = new RegExp(`(\\.max\\(${varName}Max\\))(\\.default\\()`, "g");
    const newSrc = src.replace(re, (_, maxPart, defaultPart) => {
      patchCount++;
      return `${maxPart}.int()${defaultPart}`;
    });
    src = newSrc;
  }
}

// Patch array-item integer fields: hyd93ActiveFeatureCodes items must be integers.
// Orval emits zod.array(zod.number()) for `type: array, items: {type: integer}`;
// we need zod.array(zod.number().int()) so floats like 89.5 are rejected.
for (const prefix of SCHEMAS) {
  const camelPrefix = prefix.charAt(0).toLowerCase() + prefix.slice(1);
  const varName = `${camelPrefix}Hyd93ActiveFeatureCodes`;
  const re = new RegExp(
    `zod\\.array\\(zod\\.number\\(\\)\\)\\.default\\(${varName}Default\\)`,
    "g"
  );
  const newSrc = src.replace(re, () => {
    patchCount++;
    return `zod.array(zod.number().int()).default(${varName}Default)`;
  });
  src = newSrc;
}

if (src === before) {
  const missing = [];
  for (const prefix of SCHEMAS) {
    for (const field of INTEGER_FIELDS) {
      const camelPrefix = prefix.charAt(0).toLowerCase() + prefix.slice(1);
      const varName = `${camelPrefix}${field}`;
      const alreadyPatched = new RegExp(
        `\\.max\\(${varName}Max\\)\\.int\\(\\)\\.default\\(`
      );
      if (!alreadyPatched.test(src)) {
        missing.push(varName);
      }
    }
  }

  // Verify array-item integer fields are already patched.
  for (const prefix of SCHEMAS) {
    const camelPrefix = prefix.charAt(0).toLowerCase() + prefix.slice(1);
    const varName = `${camelPrefix}Hyd93ActiveFeatureCodes`;
    const alreadyPatched = new RegExp(
      `zod\\.array\\(zod\\.number\\(\\)\\.int\\(\\)\\)\\.default\\(${varName}Default\\)`
    );
    if (!alreadyPatched.test(src)) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error(
      `patch-zod-integer-settings: missing .int() on fields: ${missing.join(", ")}`
    );
    process.exit(1);
  }

  console.log(
    "patch-zod-integer-settings: all integer fields already have .int() — no changes needed"
  );
  process.exit(0);
}

writeFileSync(target, src, "utf8");
console.log(
  `patch-zod-integer-settings: added .int() to ${patchCount} integer field(s) in ${target}`
);
