#!/usr/bin/env node
/**
 * Failure Gate lint guard — verifies that every plan file in .local/tasks/
 * contains the mandatory "## Pre-existing failures to ignore" section.
 *
 * Run:  node scripts/check-failure-gate.mjs
 *
 * Flags:
 *   --fix-stub   Append the "None known" template to each non-compliant file
 *                instead of just reporting it. Prints a warning per file patched.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files missing the required section
 */

import { readdir, readFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TASKS_DIR = ".local/tasks";
const REQUIRED_HEADING = "## Pre-existing failures to ignore";

const STUB_TEMPLATE = `
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding
it is a regression you caused. Only treat a consistent 3/3 failure as your
responsibility.
`;

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
const compliant = [];
const nonCompliant = [];

for (const file of files) {
  const filePath = join(TASKS_DIR, file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    nonCompliant.push(file);
    continue;
  }

  const lines = content.split("\n");
  const hasSection = lines.some((line) => line.trimEnd() === REQUIRED_HEADING);

  if (hasSection) {
    compliant.push(file);
  } else {
    nonCompliant.push(file);

    if (fixStub) {
      try {
        await appendFile(filePath, STUB_TEMPLATE, "utf8");
        console.warn(`check-failure-gate [--fix-stub] ⚠ patched "${file}" — appended "None known" template.`);
      } catch (err) {
        console.error(`check-failure-gate — failed to patch "${file}": ${err.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\ncheck-failure-gate — scanned ${files.length} plan file(s) in "${TASKS_DIR}":\n`);

for (const f of compliant) {
  console.log(`  ✓ ${f}`);
}
for (const f of nonCompliant) {
  if (fixStub) {
    console.log(`  ✓ ${f} (patched by --fix-stub)`);
  } else {
    console.log(`  ✗ ${f} — missing "${REQUIRED_HEADING}"`);
  }
}

if (nonCompliant.length > 0 && !fixStub) {
  console.error(
    `\ncheck-failure-gate — ${nonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan must contain a "${REQUIRED_HEADING}" section.\n` +
      `Run with --fix-stub to append the "None known" template automatically.`,
  );
  process.exit(1);
}

const patchedCount = fixStub ? nonCompliant.length : 0;
const passCount = compliant.length + patchedCount;
console.log(
  `\ncheck-failure-gate — ${passCount}/${files.length} file(s) compliant.${patchedCount > 0 ? ` (${patchedCount} patched)` : ""} ✓`,
);
process.exit(0);
