#!/usr/bin/env node
/**
 * Failure Gate lint guard — verifies that every plan file in .local/tasks/
 * contains both mandatory sections:
 *   1. "## Pre-existing failures to ignore"
 *   2. "## Validation"
 *
 * Run:  node scripts/check-failure-gate.mjs
 *
 * Flags:
 *   --fix-stub   Append stub templates for any missing sections instead of
 *                just reporting them. Prints a warning per file patched.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files missing one or both required sections
 */

import { readdir, readFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TASKS_DIR = ".local/tasks";

const REQUIRED_HEADINGS = [
  "## Pre-existing failures to ignore",
  "## Validation",
];

const STUBS = {
  "## Pre-existing failures to ignore": `
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding
it is a regression you caused. Only treat a consistent 3/3 failure as your
responsibility.
`,
  "## Validation": `
## Validation
**Command:** \`<mid-weight tier for this project>\`
**Why:** <replace with one-line justification — what this command covers and why it fits the scope of this task>
`,
};

const fixStub = process.argv.includes("--fix-stub");

// ---------------------------------------------------------------------------
// Read plan files
// ---------------------------------------------------------------------------
if (!existsSync(TASKS_DIR)) {
  console.log(`check-failure-gate — tasks directory "${TASKS_DIR}" does not exist. Nothing to check. ✓`);
  process.exit(0);
}

let files;
try {
  const entries = await readdir(TASKS_DIR);
  files = entries.filter((f) => f.endsWith(".md")).sort();
} catch (err) {
  console.error(`check-failure-gate — failed to read "${TASKS_DIR}": ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  console.log(`check-failure-gate — no .md files found in "${TASKS_DIR}". Nothing to check. ✓`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------
/** @type {Array<{file: string, missing: string[]}>} */
const results = [];

for (const file of files) {
  const filePath = join(TASKS_DIR, file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    results.push({ file, missing: REQUIRED_HEADINGS.slice() });
    continue;
  }

  const lines = content.split("\n");
  const missing = REQUIRED_HEADINGS.filter(
    (heading) => !lines.some((line) => line.trimEnd() === heading),
  );

  if (missing.length > 0 && fixStub) {
    for (const heading of missing) {
      try {
        await appendFile(filePath, STUBS[heading], "utf8");
        console.warn(
          `check-failure-gate [--fix-stub] ⚠ patched "${file}" — appended stub for "${heading}".`,
        );
      } catch (err) {
        console.error(`check-failure-gate — failed to patch "${file}" (${heading}): ${err.message}`);
      }
    }
  }

  results.push({ file, missing });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\ncheck-failure-gate — scanned ${files.length} plan file(s) in "${TASKS_DIR}":\n`);

let nonCompliantCount = 0;
for (const { file, missing } of results) {
  if (missing.length === 0) {
    console.log(`  ✓ ${file}`);
  } else if (fixStub) {
    console.log(`  ✓ ${file} (patched by --fix-stub: ${missing.join(", ")})`);
  } else {
    nonCompliantCount++;
    console.log(`  ✗ ${file} — missing: ${missing.map((h) => `"${h}"`).join(", ")}`);
  }
}

if (nonCompliantCount > 0) {
  console.error(
    `\ncheck-failure-gate — ${nonCompliantCount} non-compliant plan file(s) found.\n` +
      `Each plan must contain both required sections:\n` +
      REQUIRED_HEADINGS.map((h) => `  • "${h}"`).join("\n") + "\n" +
      `Run with --fix-stub to append stub templates automatically.`,
  );
  process.exit(1);
}

const patchedCount = fixStub ? results.filter((r) => r.missing.length > 0).length : 0;
const passCount = results.filter((r) => r.missing.length === 0).length + patchedCount;
console.log(
  `\ncheck-failure-gate — ${passCount}/${files.length} file(s) compliant.${patchedCount > 0 ? ` (${patchedCount} patched)` : ""} ✓`,
);
process.exit(0);
