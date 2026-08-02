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
 *   --fix-stub   Append stubs for whichever required sections are missing in
 *                each non-compliant file instead of just reporting them.
 *                Prints a warning per file patched.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files missing at least one required section
 */

import { readdir, readFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TASKS_DIR = ".local/tasks";

const REQUIRED_SECTIONS = [
  {
    heading: "## Pre-existing failures to ignore",
    stub: `
## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** If a test fails, retry it 3× in isolation before concluding
it is a regression you caused. Only treat a consistent 3/3 failure as your
responsibility.
`,
  },
  {
    heading: "## Validation",
    stub: `
## Validation
**Command:** \`test-standard\`
**Why:** <replace with one-line justification — what this command covers and why it fits the scope of this task>
`,
  },
];

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
const nonCompliant = []; // { file, missingSections[] }

for (const file of files) {
  const filePath = join(TASKS_DIR, file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    nonCompliant.push({ file, missingSections: REQUIRED_SECTIONS.map((s) => s.heading) });
    continue;
  }

  const lines = content.split("\n");
  const missingSections = REQUIRED_SECTIONS.filter(
    ({ heading }) => !lines.some((line) => line.trimEnd() === heading),
  );

  if (missingSections.length === 0) {
    compliant.push(file);
  } else {
    nonCompliant.push({ file, missingSections: missingSections.map((s) => s.heading) });

    if (fixStub) {
      for (const section of missingSections) {
        try {
          await appendFile(filePath, section.stub, "utf8");
          console.warn(
            `check-failure-gate [--fix-stub] ⚠ patched "${file}" — appended stub for "${section.heading}".`,
          );
        } catch (err) {
          console.error(`check-failure-gate — failed to patch "${file}" with "${section.heading}": ${err.message}`);
        }
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
for (const { file, missingSections } of nonCompliant) {
  if (fixStub) {
    console.log(`  ✓ ${file} (patched by --fix-stub: ${missingSections.join(", ")})`);
  } else {
    console.log(`  ✗ ${file} — missing: ${missingSections.join(", ")}`);
  }
}

if (nonCompliant.length > 0 && !fixStub) {
  const sectionNames = [...new Set(nonCompliant.flatMap((e) => e.missingSections))].join(", ");
  console.error(
    `\ncheck-failure-gate — ${nonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan must contain all required sections: ${REQUIRED_SECTIONS.map((s) => `"${s.heading}"`).join(", ")}.\n` +
      `Missing sections across files: ${sectionNames}.\n` +
      `Run with --fix-stub to append stubs automatically.`,
  );
  process.exit(1);
}

const patchedCount = fixStub ? nonCompliant.length : 0;
const passCount = compliant.length + patchedCount;
console.log(
  `\ncheck-failure-gate — ${passCount}/${files.length} file(s) compliant.${patchedCount > 0 ? ` (${patchedCount} patched)` : ""} ✓`,
);
process.exit(0);
