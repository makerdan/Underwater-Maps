#!/usr/bin/env node
/**
 * Failure Gate lint guard — verifies that every plan file in .local/tasks/
 * contains both mandatory sections:
 *   1. "## Pre-existing failures to ignore"
 *   2. "## Validation"
 *
 * Also checks that any file whose ## Validation section is present contains
 * both a "**Why:**" line and a "**Do not escalate:**" line, and detects
 * unfilled validation stubs — plan files where the Validation section still
 * contains the raw placeholder text appended by --fix-stub instead of a real
 * command and justification.
 *
 * Run:  node scripts/check-failure-gate.mjs
 *
 * Flags:
 *   --fix-stub    Append stubs for whichever required sections are missing in
 *                 each non-compliant file instead of just reporting them.
 *                 Also inserts the **Why:** line after **Command:** and the
 *                 **Do not escalate:** line after **Why:** when either is
 *                 absent from an existing Validation section.
 *                 Prints a warning per file patched.
 *   --stubs-only  Skip the required-headings check and only report unfilled
 *                 stub placeholders and missing required validation lines.
 *                 Used by the CI fast-tier step so that old pre-mandate plan
 *                 files (which lack the required sections) do not permanently
 *                 break the fast tier.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files missing at least one required section, OR one or
 *       more files still contain unfilled stub placeholders, OR one or more
 *       files have ## Validation but are missing the **Why:** or
 *       **Do not escalate:** line
 */

import { readdir, readFile, appendFile, writeFile } from "fs/promises";
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
**Do not escalate:** Run exactly this command. Pre-existing failures are
handled above — they are never a reason to run a heavier tier.
`,
  },
];

// ---------------------------------------------------------------------------
// Required lines within the ## Validation section
// Each entry: { marker, fixLine, placeholder, insertAfterMarker }
//   marker            — startsWith string to detect the line is present
//   fixLine           — the line(s) to insert when --fix-stub patches a file
//                       that already has ## Validation but lacks this line
//   placeholder       — recognisable string added by an old --fix-stub that a
//                       human must still fill in
//   insertAfterMarker — startsWith string of the line this should follow;
//                       falls back to inserting right after ## Validation
// ---------------------------------------------------------------------------
const REQUIRED_VALIDATION_LINES = [
  {
    marker: "**Why:**",
    fixLine: "**Why:** <replace with one-line justification>",
    placeholder: "**Why:** <replace with one-line justification>",
    insertAfterMarker: "**Command:**",
  },
  {
    marker: "**Do not escalate:**",
    fixLine:
      "**Do not escalate:** Run exactly this command. Pre-existing failures are\n" +
      "handled above — they are never a reason to run a heavier tier.",
    placeholder: "**Do not escalate:** <FILL IN>",
    insertAfterMarker: "**Why:**",
  },
];

const fixStub = process.argv.includes("--fix-stub");
// --stubs-only: skip the required-headings check and only report unfilled stub
// placeholders and missing required validation lines. Used by the CI fast-tier
// step so that old pre-mandate plan files (which lack the required sections)
// do not permanently break the fast tier. The missing-sections check remains
// available for manual audits.
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
  ...REQUIRED_VALIDATION_LINES.map((r) => r.placeholder),
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
// Helper: insert a required line into an existing ## Validation section.
// Inserts immediately after the line that starts with insertAfterMarker
// (scanned within the section); falls back to right after ## Validation.
// ---------------------------------------------------------------------------
async function insertValidationLine(filePath, content, fixLine, insertAfterMarker) {
  const lines = content.split("\n");
  // Find the ## Validation heading
  const valIdx = lines.findIndex((l) => l.trimEnd() === "## Validation");
  if (valIdx === -1) return content; // no Validation section — nothing to insert

  // Look for insertAfterMarker within the section (before the next ## heading)
  let insertAfter = -1;
  for (let i = valIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break; // next section
    if (insertAfterMarker && lines[i].startsWith(insertAfterMarker)) {
      insertAfter = i;
      break;
    }
  }

  const insertAt = insertAfter !== -1 ? insertAfter + 1 : valIdx + 1;
  const newLines = [
    ...lines.slice(0, insertAt),
    fixLine,
    ...lines.slice(insertAt),
  ];
  const newContent = newLines.join("\n");
  await writeFile(filePath, newContent, "utf8");
  return newContent;
}

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------
const compliant = [];
const nonCompliant = []; // { file, missingSections[], unfilledPlaceholders[], missingValidationLines[] }

for (const file of files) {
  const filePath = join(TASKS_DIR, file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    nonCompliant.push({
      file,
      missingSections: REQUIRED_SECTIONS.map((s) => s.heading),
      unfilledPlaceholders: [],
      missingValidationLines: [],
    });
    continue;
  }

  const lines = content.split("\n");
  const missingSections = stubsOnly
    ? []
    : REQUIRED_SECTIONS.filter(
        ({ heading }) => !lines.some((line) => line.trimEnd() === heading),
      );

  // Check only for placeholders that appear at the start of a line (ignoring
  // leading whitespace). This avoids false positives when the placeholder
  // string is mentioned in prose or a task description inside backticks.
  const unfilledPlaceholders = STUB_PLACEHOLDERS.filter((p) =>
    lines.some((line) => line.trimStart().startsWith(p)),
  );

  // Check for required lines within the Validation section — only when the
  // section is present (missing section is already caught by missingSections).
  const hasValidationSection = lines.some((l) => l.trimEnd() === "## Validation");
  const missingValidationLines = hasValidationSection
    ? REQUIRED_VALIDATION_LINES.filter(
        ({ marker }) => !lines.some((l) => l.trimStart().startsWith(marker)),
      )
    : [];

  if (
    missingSections.length === 0 &&
    unfilledPlaceholders.length === 0 &&
    missingValidationLines.length === 0
  ) {
    compliant.push(file);
  } else {
    nonCompliant.push({
      file,
      missingSections: missingSections.map((s) => s.heading),
      unfilledPlaceholders,
      missingValidationLines: missingValidationLines.map((r) => r.marker),
    });

    if (fixStub) {
      // Append stubs for entirely missing sections
      if (missingSections.length > 0) {
        for (const section of missingSections) {
          try {
            await appendFile(filePath, section.stub, "utf8");
            // Re-read content after patching so subsequent fixes see the update
            content = await readFile(filePath, "utf8");
            console.warn(
              `check-failure-gate [--fix-stub] ⚠ patched "${file}" — appended stub for "${section.heading}".`,
            );
          } catch (err) {
            console.error(
              `check-failure-gate — failed to patch "${file}" with "${section.heading}": ${err.message}`,
            );
          }
        }
      }

      // Insert missing required validation lines into existing Validation section.
      // Iterate directly over missingValidationLines (already the filtered list
      // of REQUIRED_VALIDATION_LINES entries whose marker was absent).
      if (missingValidationLines.length > 0) {
        for (const rvl of missingValidationLines) {
          try {
            content = await insertValidationLine(filePath, content, rvl.fixLine, rvl.insertAfterMarker);
            console.warn(
              `check-failure-gate [--fix-stub] ⚠ patched "${file}" — inserted "${rvl.marker}" into Validation section.`,
            );
          } catch (err) {
            console.error(
              `check-failure-gate — failed to insert "${rvl.marker}" into "${file}": ${err.message}`,
            );
          }
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
for (const { file, missingSections, unfilledPlaceholders, missingValidationLines } of nonCompliant) {
  const hasMissing = !fixStub && missingSections.length > 0;
  const hasMissingLines = !fixStub && missingValidationLines.length > 0;
  if (!hasMissing && !hasMissingLines && unfilledPlaceholders.length === 0) {
    // patched by --fix-stub
    const patchDetails = [
      ...missingSections.map((s) => `section: ${s}`),
      ...missingValidationLines.map((m) => `line: ${m}`),
    ].join(", ");
    console.log(`  ✓ ${file} (patched by --fix-stub: ${patchDetails})`);
  } else {
    const reasons = [];
    if (hasMissing) reasons.push(`missing section(s): ${missingSections.join(", ")}`);
    if (hasMissingLines)
      reasons.push(
        `## Validation present but missing required line(s): ${missingValidationLines.join(", ")}`,
      );
    if (unfilledPlaceholders.length > 0) {
      reasons.push(`unfilled stub placeholder(s): ${unfilledPlaceholders.map((p) => `"${p}"`).join(", ")}`);
    }
    console.log(`  ✗ ${file} — ${reasons.join("; ")}`);
  }
}

const trueNonCompliant = nonCompliant.filter(
  ({ missingSections, unfilledPlaceholders, missingValidationLines }) =>
    (!fixStub && missingSections.length > 0) ||
    unfilledPlaceholders.length > 0 ||
    (!fixStub && missingValidationLines.length > 0),
);

if (trueNonCompliant.length > 0) {
  const sectionNames = [...new Set(trueNonCompliant.flatMap((e) => e.missingSections))].join(", ");
  const missingLineNames = [
    ...new Set(trueNonCompliant.flatMap((e) => e.missingValidationLines)),
  ].join(", ");
  console.error(
    `\ncheck-failure-gate — ${trueNonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan must:\n` +
      `  1. Contain all required sections: ${REQUIRED_SECTIONS.map((s) => `"${s.heading}"`).join(", ")}.\n` +
      (sectionNames ? `     Missing sections across files: ${sectionNames}.\n` : "") +
      `  2. Have no unfilled stub placeholders in the Validation section.\n` +
      `     Replace "<mid-weight tier for this project>" with the real command,\n` +
      `     "<replace with one-line justification>" with a real justification,\n` +
      `     and "<FILL IN>" with the real do-not-escalate rationale.\n` +
      `  3. Include both a "**Why:**" line and a "**Do not escalate:**" line in\n` +
      `     the ## Validation section.\n` +
      (missingLineNames ? `     Files missing required line(s): see listing above.\n` : "") +
      `Run with --fix-stub to append stubs for missing sections automatically.`,
  );
  process.exit(1);
}

const patchedCount = fixStub
  ? nonCompliant.filter(
      (e) => e.missingSections.length > 0 || e.missingValidationLines.length > 0,
    ).length
  : 0;
const passCount = compliant.length + patchedCount;
console.log(
  `\ncheck-failure-gate — ${passCount}/${files.length} file(s) compliant.${patchedCount > 0 ? ` (${patchedCount} patched)` : ""} ✓`,
);
process.exit(0);
