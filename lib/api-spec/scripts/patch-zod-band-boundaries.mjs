#!/usr/bin/env node
/**
 * Post-codegen patch: adds .superRefine() rules to the bandBoundaries field
 * in GetSettingsResponse, PutSettingsBody, and PutSettingsResponse inside the
 * generated Zod schema. Orval cannot emit superRefine calls from plain OpenAPI
 * descriptions, so this script runs immediately after orval and injects the
 * constraints:
 *   - first element must be 0
 *   - last element must be 2000
 *   - all elements must be strictly increasing
 *
 * Matching strategy: use a regex that precisely targets the bandBoundaries
 * describe() call by its unique per-schema variable name, matching the
 * single-quoted describe string (no embedded quotes in that text) so we never
 * accidentally patch a neighbouring field that also has .describe('...').
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..", "..", "..");
const target = resolve(root, "lib", "api-zod", "src", "generated", "api.ts");

const REFINE_BODY = `.superRefine((arr, ctx) => {
  if (arr[0] !== 0) {
    ctx.addIssue({ code: zod.ZodIssueCode.custom, message: "bandBoundaries first element must be 0", path: [0] });
  }
  if (arr[arr.length - 1] !== 2000) {
    ctx.addIssue({ code: zod.ZodIssueCode.custom, message: "bandBoundaries last element must be 2000", path: [arr.length - 1] });
  }
  for (let i = 1; i < arr.length; i++) {
    if (arr[i]! <= arr[i - 1]!) {
      ctx.addIssue({ code: zod.ZodIssueCode.custom, message: "bandBoundaries must be strictly increasing", path: [i] });
    }
  }
})`;

let src = readFileSync(target, "utf8");
const before = src;

// The generated bandBoundaries field for each schema is uniquely identified by
// its per-schema default variable name.  We use a regex that matches precisely
// `.default(<prefix>BandBoundariesDefault).describe('<non-quote text>')`
// so that fields with different names that also have .describe() calls are
// never accidentally patched.
//
// Capture group 1 = everything up to and including the closing ')' of .describe(...)
// We insert REFINE_BODY immediately after that ')'.
const SCHEMAS = [
  "getSettingsResponse",
  "putSettingsBody",
  "putSettingsResponse",
];

let patchCount = 0;
for (const prefix of SCHEMAS) {
  // Check if already patched — if superRefine follows the describe() call, skip.
  const alreadyPatched = new RegExp(
    `${prefix}BandBoundariesDefault\\)\\.describe\\('[^']*'\\)\\.superRefine`,
  ).test(src);
  if (alreadyPatched) {
    console.log(`patch-zod-band-boundaries: "${prefix}" already patched — skipping`);
    patchCount++;
    continue;
  }
  // [^']* matches the describe text (no embedded single-quotes in bandBoundaries text)
  const re = new RegExp(
    `(${prefix}BandBoundariesDefault\\)\\.describe\\('[^']*'\\))`,
  );
  const newSrc = src.replace(re, (_, captured) => captured + REFINE_BODY);
  if (newSrc === src) {
    console.warn(`patch-zod-band-boundaries: pattern not found for "${prefix}" — skipping`);
    continue;
  }
  src = newSrc;
  patchCount++;
}

const EXPECTED_PATCH_COUNT = SCHEMAS.length;
if (patchCount !== EXPECTED_PATCH_COUNT) {
  console.error(
    `patch-zod-band-boundaries: expected to patch ${EXPECTED_PATCH_COUNT} schemas but only patched ${patchCount} — the generated schema shape may have changed`
  );
  process.exit(1);
}

if (src !== before) {
  writeFileSync(target, src, "utf8");
}
console.log(`patch-zod-band-boundaries: patched ${patchCount} bandBoundaries field(s) in ${target}`);
