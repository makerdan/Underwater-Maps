#!/usr/bin/env node
/**
 * Failure Gate lint guard — verifies that every plan file in .local/tasks/
 * contains both mandatory sections:
 *   1. "## Pre-existing failures to ignore"
 *   2. "## Validation"
 *
 * Also detects unfilled validation stubs — plan files where the Validation
 * section still contains the raw placeholder text appended by --fix-stub
 * instead of a real command and justification.
 *
 * Run:  node scripts/check-failure-gate.mjs
 *
 * Flags:
 *   --fix-stub    Append stubs for whichever required sections are missing in
 *                 each non-compliant file instead of just reporting them.
 *                 Prints a warning per file patched.
 *   --stubs-only  Skip the required-headings check and only report unfilled
 *                 stub placeholders. Used by the CI fast-tier step so that old
 *                 pre-mandate plan files (which lack the required sections) do
 *                 not permanently break the fast tier.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files missing at least one required section, OR one or
 *       more files still contain unfilled stub placeholders
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
**Why:** Placeholder — review before running this task (state what the command covers and why it fits the task scope).
`,
  },
];

const fixStub = process.argv.includes("--fix-stub");
// --stubs-only: skip the required-headings check and only report unfilled stub
// placeholders. Used by the CI fast-tier step so that old pre-mandate plan
// files (which lack the required sections) do not permanently break the fast
// tier. The missing-sections check remains available for manual audits.
const stubsOnly = process.argv.includes("--stubs-only");

// ---------------------------------------------------------------------------
// Stub placeholder patterns — these match the exact lines that --fix-stub
// appends. A file is flagged only when these literal strings appear as
// actual content (not merely mentioned in prose or task-description text).
// Both anchors include the surrounding markup so incidental mentions of the
// placeholder phrase in task descriptions do not trigger a false positive.
// ---------------------------------------------------------------------------
const STUB_PLACEHOLDERS = [
  "**Command:** `<mid-weight tier for this project>`",
  "**Why:** <replace with one-line justification",
];

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
const nonCompliant = []; // { file, missingSections[], unfilledPlaceholders[] }

for (const file of files) {
  const filePath = join(TASKS_DIR, file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    nonCompliant.push({ file, missingSections: REQUIRED_SECTIONS.map((s) => s.heading), unfilledPlaceholders: [] });
    continue;
  }

  const lines = content.split("\n");
  const missingSections = stubsOnly
    ? []
    : REQUIRED_SECTIONS.filter(
        ({ heading }) => !lines.some((line) => line.trimEnd() === heading),
      );

  const unfilledPlaceholders = STUB_PLACEHOLDERS.filter((p) => content.includes(p));

  if (missingSections.length === 0 && unfilledPlaceholders.length === 0) {
    compliant.push(file);
  } else {
    nonCompliant.push({ file, missingSections: missingSections.map((s) => s.heading), unfilledPlaceholders });

    if (fixStub && missingSections.length > 0) {
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
for (const { file, missingSections, unfilledPlaceholders } of nonCompliant) {
  const hasMissing = !fixStub && missingSections.length > 0;
  if (!hasMissing && unfilledPlaceholders.length === 0) {
    // patched by --fix-stub
    console.log(`  ✓ ${file} (patched by --fix-stub: ${missingSections.join(", ")})`);
  } else {
    const reasons = [];
    if (hasMissing) reasons.push(`missing: ${missingSections.join(", ")}`);
    if (unfilledPlaceholders.length > 0) {
      reasons.push(`unfilled stub placeholder(s): ${unfilledPlaceholders.map((p) => `"${p}"`).join(", ")}`);
    }
    console.log(`  ✗ ${file} — ${reasons.join("; ")}`);
  }
}

const trueNonCompliant = nonCompliant.filter(
  ({ missingSections, unfilledPlaceholders }) =>
    (!fixStub && missingSections.length > 0) || unfilledPlaceholders.length > 0,
);

if (trueNonCompliant.length > 0) {
  const sectionNames = [...new Set(trueNonCompliant.flatMap((e) => e.missingSections))].join(", ");
  console.error(
    `\ncheck-failure-gate — ${trueNonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan must:\n` +
      `  1. Contain all required sections: ${REQUIRED_SECTIONS.map((s) => `"${s.heading}"`).join(", ")}.\n` +
      (sectionNames ? `     Missing sections across files: ${sectionNames}.\n` : "") +
      `  2. Have no unfilled stub placeholders in the Validation section.\n` +
      `     Replace "<mid-weight tier for this project>" with the real command\n` +
      `     and "<replace with one-line justification" with a real justification.\n` +
      `Run with --fix-stub to append stubs for missing sections automatically.`,
  );
  process.exit(1);
}

const patchedCount = fixStub ? nonCompliant.filter((e) => e.missingSections.length > 0).length : 0;
const passCount = compliant.length + patchedCount;
console.log(
  `\ncheck-failure-gate — ${passCount}/${files.length} file(s) compliant.${patchedCount > 0 ? ` (${patchedCount} patched)` : ""} ✓`,
);
process.exit(0);
