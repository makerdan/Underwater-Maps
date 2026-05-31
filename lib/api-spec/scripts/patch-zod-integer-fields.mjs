#!/usr/bin/env node
/**
 * Post-codegen patch: adds .int() to OpenAPI `type: integer` settings fields
 * that orval emits as plain zod.number() without the integer constraint.
 *
 * Without .int(), sending a non-integer float (e.g. zonePaintSlot: 1.5) passes
 * validation when the API should return 400. This script runs immediately after
 * orval and inserts .int() right after zod.number() for the affected fields.
 *
 * Fields patched:
 *   - zonePaintSlot      (0–3 integer slot index)
 *   - zonePaintBrushRadius (1–20 integer radius)
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
  "ZonePaintSlot",
  "ZonePaintBrushRadius",
];

let src = readFileSync(target, "utf8");
const before = src;
let patchCount = 0;

for (const prefix of SCHEMAS) {
  for (const field of INTEGER_FIELDS) {
    const varPrefix = prefix + field;
    // Match: zod.number().min(<varPrefix>Min).max(<varPrefix>Max)
    // and insert .int() right after zod.number()
    const re = new RegExp(
      `(zod\\.number\\(\\))(\\.min\\(${varPrefix}Min\\)\\.max\\(${varPrefix}Max\\))`,
    );
    const newSrc = src.replace(re, (_, numPart, rest) => numPart + ".int()" + rest);
    if (newSrc === src) {
      console.warn(`patch-zod-integer-fields: pattern not found for "${varPrefix}" — skipping`);
      continue;
    }
    src = newSrc;
    patchCount++;
  }
}

if (patchCount === 0) {
  console.error("patch-zod-integer-fields: no fields were patched — the generated schema shape may have changed");
  process.exit(1);
}

writeFileSync(target, src, "utf8");
console.log(`patch-zod-integer-fields: patched ${patchCount} integer field(s) in ${target}`);
