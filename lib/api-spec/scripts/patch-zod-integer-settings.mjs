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
