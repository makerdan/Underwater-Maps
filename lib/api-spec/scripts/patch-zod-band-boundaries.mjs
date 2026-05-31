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

// The generated bandBoundaries field for each schema ends with a unique suffix
// like `...BoundariesDefault).describe('...'),`. We patch each occurrence by
// inserting .superRefine(...) between the .describe(...) call and the trailing
// comma. We match the unique per-schema variable names to be precise.
const SCHEMAS = [
  "getSettingsResponse",
  "putSettingsBody",
  "putSettingsResponse",
];

let patchCount = 0;
for (const prefix of SCHEMAS) {
  // Match: ...BoundariesDefault).describe('...' boundaries description...'),
  // The unique anchor is `<prefix>BandBoundariesDefault).describe('`
  // We replace the closing `'),` with `')${REFINE_BODY},`
  const anchor = `${prefix}BandBoundariesDefault).describe('`;
  const idx = src.indexOf(anchor);
  if (idx === -1) {
    console.warn(`patch-zod-band-boundaries: anchor not found for "${prefix}" — skipping`);
    continue;
  }

  // Find the closing `'),` that ends the .describe(...) call for this field
  const descStart = idx + anchor.length;
  const closingIdx = src.indexOf(`'),`, descStart);
  if (closingIdx === -1) {
    console.warn(`patch-zod-band-boundaries: closing '), not found after anchor for "${prefix}" — skipping`);
    continue;
  }

  // Insert .superRefine(...) between the `')` and the `,`
  src = src.slice(0, closingIdx + 2) + REFINE_BODY + src.slice(closingIdx + 2);
  patchCount++;
}

const EXPECTED_PATCH_COUNT = SCHEMAS.length;
if (patchCount !== EXPECTED_PATCH_COUNT) {
  console.error(
    `patch-zod-band-boundaries: expected to patch ${EXPECTED_PATCH_COUNT} schemas but only patched ${patchCount} — the generated schema shape may have changed`
  );
  process.exit(1);
}

if (src === before) {
  console.error("patch-zod-band-boundaries: file unchanged after patching — possible logic error");
  process.exit(1);
}

writeFileSync(target, src, "utf8");
console.log(`patch-zod-band-boundaries: patched ${patchCount} bandBoundaries field(s) in ${target}`);
