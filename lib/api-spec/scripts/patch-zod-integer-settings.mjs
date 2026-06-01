#!/usr/bin/env node
/**
 * Post-codegen patch: adds .int() to integer-typed settings fields in the
 * generated Zod schema. Orval emits zod.number() for OpenAPI `type: integer`
 * without the .int() refinement, so floats like 1.5 would pass min/max
 * validation. This script runs after orval and inserts .int() between
 * .max(...) and .default(...) for each integer field in the three settings
 * schemas (GetSettingsResponse, PutSettingsBody, PutSettingsResponse).
 *
 * Fields patched: defaultSpeedTier, gpsRecordingInterval, zonePaintBrushRadius,
 * zonePaintSlot.
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
  console.error(
    "patch-zod-integer-settings: file unchanged after patching — no integer fields matched"
  );
  process.exit(1);
}

writeFileSync(target, src, "utf8");
console.log(
  `patch-zod-integer-settings: added .int() to ${patchCount} integer field(s) in ${target}`
);
