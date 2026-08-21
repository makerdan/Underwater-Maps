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

import { readdir, readFile } from "fs/promises";
import { existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { VALIDATION_COMMANDS } from "./register-validation-commands.mjs";

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
**Why:** <replace with one-line justification>
**Do not escalate:** Run exactly this command. Pre-existing failures are
handled above — they are never a reason to run a heavier tier.
`,
  },
];

// ---------------------------------------------------------------------------
// Required lines within the ## Validation section
// Each entry: { marker, fixLine, placeholder?, insertAfterMarker?, validateLine? }
//   marker            — startsWith string to detect the line is present
//   fixLine           — the line(s) to insert when --fix-stub patches a file
//                       that already has ## Validation but lacks this line
//   placeholder       — recognisable string added by an old --fix-stub that a
//                       human must still fill in (optional)
//   insertAfterMarker — startsWith string of the line this entry should follow
//                       within the section; falls back to inserting right after
//                       ## Validation when absent or not found
//   validateLine      — optional (line: string) => string | null; called with
//                       the matched line (trimStart'd) when present. Return a
//                       descriptive error string if invalid, or null if valid.
//                       Only called when the marker line IS present.
// ---------------------------------------------------------------------------

// Derive valid tier names from VALIDATION_COMMANDS (single source of truth).
// Only tiered commands (non-null budgetKey) are accepted as **Command:** values.
// Adding or removing a tier in register-validation-commands.mjs automatically
// updates this set — no separate hardcoded list to keep in sync.
const VALID_TIERS = VALIDATION_COMMANDS.filter((c) => c.budgetKey !== null).map((c) => c.name);

const REQUIRED_VALIDATION_LINES = [
  {
    marker: "**Command:**",
    fixLine: "**Command:** `test-standard`",
    // no insertAfterMarker — falls back to right after ## Validation (first line)
    validateLine(line) {
      const m = line.match(/\*\*Command:\*\*\s+`([^`]+)`/);
      if (!m) {
        return `**Command:** line must contain a backtick-quoted tier name (e.g. \`test-standard\`)`;
      }
      if (!VALID_TIERS.includes(m[1])) {
        return `**Command:** "${m[1]}" is not a valid tier — must be one of: ${VALID_TIERS.join(", ")}`;
      }
      return null;
    },
  },
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
// --skip-if-no-task: exit 0 immediately when TASK_PLAN_FILE is not set.
// Used by the fast-tier validation steps (fix:failure-gate-stubs and
// check:failure-gate) so that ad-hoc / developer runs do not scan the
// full .local/tasks/ archive of 909+ pre-existing gitignored stub files.
// The self-test and any explicit archive audit continue to work by omitting
// this flag.
const skipIfNoTask = process.argv.includes("--skip-if-no-task");
// --stubs-only: skip the required-headings check (missing sections are not
// reported) and only report unfilled stub placeholders and missing required
// validation lines. Used by the CI fast-tier step so that old pre-mandate
// plan files (which lack the required sections) do not permanently break the
// fast tier.
//
// IMPORTANT: --stubs-only only skips the *missing-section* check. When a
// ## Validation section IS present, all inner-line validation still runs in
// full — including the validateLine check that rejects unrecognised
// **Command:** tier names. A plan with `**Command:** \`not-a-real-tier\``
// will be caught and exit 1 even in --stubs-only mode.
const stubsOnly = process.argv.includes("--stubs-only");

// ---------------------------------------------------------------------------
// Stub placeholder patterns — these match the exact lines that --fix-stub
// appends. A file is flagged only when these literal strings appear as
// actual content (not merely mentioned in prose or task-description text).
// Both anchors include the surrounding markup so incidental mentions of the
// placeholder phrase in task descriptions do not trigger a false positive.
//
// Two families of placeholder are recognised:
//   1. Fix-stub wording — the text that REQUIRED_VALIDATION_LINES[].fixLine
//      inserts when a required inner line is absent (e.g. `<replace with
//      one-line justification>`).  These come from the flatMap below.
//   2. Skill-template wording — the Failure Gate SKILL.md offers two
//      slightly different placeholder forms for the **Why:** line:
//        a. "<one-line justification — what this command covers…>"  (long form)
//        b. "<one-line justification>"                              (short form)
//      Both share the prefix "<one-line justification" so one startsWith
//      entry covers both.
//   3. Legacy section-stub wording — when the entire ## Validation section
//      was missing, the old REQUIRED_SECTIONS stub wrote a **Why:** line
//      containing "Placeholder — review before running this task". Files
//      that were stubbed before the current fix-stub wording was standardised
//      must still be caught.
// ---------------------------------------------------------------------------
const STUB_PLACEHOLDERS = [
  "**Command:** `<mid-weight tier for this project>`",
  ...REQUIRED_VALIDATION_LINES.flatMap((r) => (r.placeholder ? [r.placeholder] : [])),
  // Skill-template angle-bracket form for **Why:** (line 153 of failure-gate SKILL.md)
  "**Why:** <one-line justification",
  // Legacy section-stub wording written by older --fix-stub runs
  "**Why:** Placeholder — review before running this task",
];

// ---------------------------------------------------------------------------
// Read plan files
// ---------------------------------------------------------------------------

// When TASK_PLAN_FILE is set (task-agent and CI environments always set it),
// restrict the check to that single file rather than scanning the full
// .local/tasks/ archive. This prevents 909 gitignored pre-existing plan files
// from blocking the fast tier in every fresh environment.
//
// When TASK_PLAN_FILE is not set (developer / manual run), the full archive
// scan proceeds as before.

const TASK_PLAN_FILE = process.env.TASK_PLAN_FILE;

let files;
/** Given an entry from `files`, return the filesystem path to read. */
let resolveFilePath;
/** Human-readable description of what was scanned, for the summary line. */
let scanDescription;

if (TASK_PLAN_FILE) {
  // Single-file mode —————————————————————————————————————————————————————
  console.log(`check-failure-gate — single-file mode: ${TASK_PLAN_FILE}`);

  if (!TASK_PLAN_FILE.endsWith(".md")) {
    console.error(
      `check-failure-gate — TASK_PLAN_FILE "${TASK_PLAN_FILE}" is not a .md file. Aborting.`,
    );
    process.exit(1);
  }

  if (!existsSync(TASK_PLAN_FILE)) {
    console.error(
      `check-failure-gate — TASK_PLAN_FILE "${TASK_PLAN_FILE}" does not exist. Aborting.`,
    );
    process.exit(1);
  }

  // Use the full/relative path as the sole entry; resolveFilePath is the identity.
  files = [TASK_PLAN_FILE];
  resolveFilePath = (f) => f;
  scanDescription = `single file "${TASK_PLAN_FILE}"`;
} else {
  // No TASK_PLAN_FILE set.
  if (skipIfNoTask) {
    // --skip-if-no-task: ad-hoc / fast-tier run — nothing task-specific to
    // validate. Exit cleanly without scanning the archive.
    console.log(
      "check-failure-gate — no TASK_PLAN_FILE set (--skip-if-no-task). Skipping. ✓",
    );
    process.exit(0);
  }

  // Archive mode — scan the full .local/tasks/ directory ——————————————————
  if (!existsSync(TASKS_DIR)) {
    console.log(`check-failure-gate — tasks directory "${TASKS_DIR}" does not exist. Nothing to check. ✓`);
    process.exit(0);
  }

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

  resolveFilePath = (f) => join(TASKS_DIR, f);
  scanDescription = `"${TASKS_DIR}"`;
}

// ---------------------------------------------------------------------------
// Helper: insert a required line into an existing ## Validation section.
// Inserts immediately after the line that starts with insertAfterMarker
// (scanned within the section); falls back to right after ## Validation.
// ---------------------------------------------------------------------------
export function insertValidationLine(
  filePathOrContent,
  contentOrFixLine,
  fixLineOrInsertAfterMarker,
  legacyInsertAfterMarker,
) {
  // Keep the historical exported signature
  // (filePath, content, fixLine, insertAfterMarker) for callers and tests.
  // The file path is intentionally ignored: patching is performed by the
  // caller's single final write, not by this pure transformation helper.
  const content =
    legacyInsertAfterMarker === undefined ? filePathOrContent : contentOrFixLine;
  const fixLine =
    legacyInsertAfterMarker === undefined ? contentOrFixLine : fixLineOrInsertAfterMarker;
  const insertAfterMarker =
    legacyInsertAfterMarker === undefined ? fixLineOrInsertAfterMarker : legacyInsertAfterMarker;
  const lines = content.split("\n");
  // Find the ## Validation heading
  const valIdx = lines.findIndex((l) => l.trimEnd() === "## Validation");
  if (valIdx === -1) {
    return { content, changed: false }; // no Validation section — nothing to insert
  }

  // Look for insertAfterMarker within the section (before the next ## heading)
  let insertAfter = -1;
  for (let i = valIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) break; // next section
    if (insertAfterMarker && lines[i].trimStart().startsWith(insertAfterMarker)) {
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
  return { content: newContent, changed: true };
}

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
const compliant = [];
const nonCompliant = []; // { file, readFailed?, missingSections[], unfilledPlaceholders[], missingValidationLines[] }

for (const file of files) {
  const filePath = resolveFilePath(file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(`check-failure-gate — could not read "${filePath}": ${err.message}`);
    nonCompliant.push({
      file,
      readFailed: true,
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

  // Collect only the lines that belong to the ## Validation section (between the
  // heading and the next ## heading or EOF). Used for both placeholder detection
  // and required-line checks, preventing false positives when a marker string
  // appears in prose, code-block examples, or task-description text elsewhere
  // in the document.
  const valHeadingIdx = lines.findIndex((l) => l.trimEnd() === "## Validation");
  const hasValidationSection = valHeadingIdx !== -1;

  const validationSectionLines = hasValidationSection
    ? (() => {
        const sectionLines = [];
        for (let i = valHeadingIdx + 1; i < lines.length; i++) {
          if (lines[i].startsWith("## ")) break;
          sectionLines.push(lines[i]);
        }
        return sectionLines;
      })()
    : [];

  // Check only for placeholders that appear at the start of a line within the
  // ## Validation section (ignoring leading whitespace). Scoping to the section
  // avoids false positives when a placeholder string is mentioned in prose,
  // code-block templates, or task descriptions elsewhere in the document.
  const unfilledPlaceholders = STUB_PLACEHOLDERS.filter((p) =>
    validationSectionLines.some((line) => line.trimStart().startsWith(p)),
  );

  // Check for required lines within the Validation section — only when the
  // section is present (missing section is already caught by missingSections).
  // Each entry in validationLineIssues is { rvl, reason, absent } where:
  //   absent — true when the marker line is entirely missing (fixable by --fix-stub)
  //   reason — human-readable error description (marker name or validateLine message)

  const validationLineIssues = hasValidationSection
    ? REQUIRED_VALIDATION_LINES.flatMap((rvl) => {
        const matchedLine = validationSectionLines.find((l) =>
          l.trimStart().startsWith(rvl.marker),
        );
        if (!matchedLine) {
          return [{ rvl, reason: `missing "${rvl.marker}" line`, absent: true }];
        }
        if (rvl.validateLine) {
          const err = rvl.validateLine(matchedLine.trimStart());
          if (err) return [{ rvl, reason: err, absent: false }];
        }
        return [];
      })
    : [];

  if (
    missingSections.length === 0 &&
    unfilledPlaceholders.length === 0 &&
    validationLineIssues.length === 0
  ) {
    compliant.push(file);
  } else {
    nonCompliant.push({
      file,
      missingSections: missingSections.map((s) => s.heading),
      unfilledPlaceholders,
      // Store descriptive reason strings for display
      missingValidationLines: validationLineIssues.map((i) => i.reason),
      // Store raw issue objects for fix-stub (need rvl + absent flag)
      _validationLineIssues: validationLineIssues,
      _patchFailures: [],
    });

    if (fixStub) {
      // Build the complete patch from the content read above, then write it once.
      // Keeping all mutations in memory prevents a concurrent editor's changes
      // from being lost between append and rewrite operations.
      let patchedContent = content;

      for (const section of missingSections) {
        patchedContent += section.stub;
        console.warn(
          `check-failure-gate [--fix-stub] ⚠ patched "${file}" — appended stub for "${section.heading}".`,
        );
      }

      // Insert lines that are entirely absent from the Validation section.
      // Lines with an invalid value (absent=false) are NOT auto-fixed — the
      // agent must correct the value manually.
      for (const { rvl } of validationLineIssues.filter((i) => i.absent)) {
        const result = insertValidationLine(
          patchedContent,
          rvl.fixLine,
          rvl.insertAfterMarker,
        );
        if (result.changed) {
          patchedContent = result.content;
          console.warn(
            `check-failure-gate [--fix-stub] ⚠ patched "${file}" — inserted "${rvl.marker}" into Validation section.`,
          );
        } else {
          const entry = nonCompliant.find((e) => e.file === file);
          entry?._patchFailures.push(
            `could not insert "${rvl.marker}" because the ## Validation section was not found`,
          );
          console.error(
            `check-failure-gate — could not insert "${rvl.marker}" into "${file}": ## Validation section not found`,
          );
        }
      }

      // Re-stub non-standard placeholder Why lines — replace skill-template
      // angle-bracket forms and legacy "Placeholder — review..." text with the
      // canonical fix-stub placeholder so all unfilled Whys use a consistent,
      // easily-recognised form.  The standard placeholder itself is NOT changed
      // here; the agent must replace it with real content manually.
      const WHY_STANDARD_PLACEHOLDER = REQUIRED_VALIDATION_LINES.find(
        (r) => r.marker === "**Why:**",
      )?.placeholder;
      const NON_STANDARD_WHY_PREFIXES = [
        "**Why:** <one-line justification",
        "**Why:** Placeholder — review before running this task",
      ];
      if (WHY_STANDARD_PLACEHOLDER) {
        const patchedLines = patchedContent.split("\n");
        const patchedValIdx = patchedLines.findIndex((l) => l.trimEnd() === "## Validation");
        if (patchedValIdx !== -1) {
          for (let i = patchedValIdx + 1; i < patchedLines.length; i++) {
            if (patchedLines[i].startsWith("## ")) break;
            const trimmed = patchedLines[i].trimStart();
            if (NON_STANDARD_WHY_PREFIXES.some((p) => trimmed.startsWith(p))) {
              patchedLines[i] = WHY_STANDARD_PLACEHOLDER;
              patchedContent = patchedLines.join("\n");
              console.warn(
                `check-failure-gate [--fix-stub] ⚠ patched "${file}" — normalised non-standard **Why:** placeholder to canonical form.`,
              );
              break;
            }
          }
        }
      }

      if (patchedContent !== content) {
        try {
          writeFileSync(filePath, patchedContent, "utf8");
        } catch (err) {
          console.error(`check-failure-gate — failed to patch "${file}": ${err.message}`);
          const entry = nonCompliant.find((e) => e.file === file);
          entry.writeFailed = true;
          entry._patchFailures.push(`failed to write patched file: ${err.message}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\ncheck-failure-gate — scanned ${files.length} plan file(s) in ${scanDescription}:\n`);

for (const f of compliant) {
  console.log(`  ✓ ${f}`);
}
for (const {
  file,
  missingSections,
  unfilledPlaceholders,
  missingValidationLines,
  _patchFailures = [],
  writeFailed,
} of nonCompliant) {
  const hasMissing = !fixStub && missingSections.length > 0;
  const hasMissingLines = !fixStub && missingValidationLines.length > 0;
  if (
    !writeFailed &&
    !hasMissing &&
    !hasMissingLines &&
    unfilledPlaceholders.length === 0 &&
    _patchFailures.length === 0
  ) {
    // patched by --fix-stub (or invalid tier in fix-stub mode — noted in patch details)
    const patchDetails = [
      ...missingSections.map((s) => `section: ${s}`),
      ...missingValidationLines.map((m) => `line: ${m}`),
    ].join(", ");
    console.log(`  ✓ ${file} (patched by --fix-stub: ${patchDetails})`);
  } else if (writeFailed || (fixStub && _patchFailures.length > 0)) {
    console.log(
      `  ✗ ${file} — ${[
        ...(writeFailed ? ["failed to write patched file"] : []),
        ..._patchFailures,
      ].join("; ")}`,
    );
  } else if (fixStub && unfilledPlaceholders.length > 0) {
    // In --fix-stub mode, unfilled placeholders cannot be auto-corrected — they
    // require manual intervention. Report them as warnings rather than errors so
    // --fix-stub can still exit 0 (the strict check will catch them on next run).
    const reasons = [`unfilled stub placeholder(s) require manual fix: ${unfilledPlaceholders.map((p) => `"${p}"`).join(", ")}`];
    console.log(`  ⚠ ${file} — ${reasons.join("; ")}`);
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
  ({ readFailed, missingSections, unfilledPlaceholders, _validationLineIssues, _patchFailures = [], writeFailed }) => {
    const issues = _validationLineIssues || [];
    const unfixableIssues = issues.filter((i) => !i.absent);
    // A file that could not be inspected is never safe to treat as compliant.
    // This must remain a hard failure in --fix-stub mode: no patch can be
    // trusted when the source content was unreadable.
    if (readFailed) return true;
    // In --fix-stub mode: absent lines and missing sections are auto-inserted
    // (exit 0 after patching); unfilled placeholders and invalid tier values
    // cannot be auto-fixed but --fix-stub still exits 0 so the pipeline can
    // proceed to the strict check step which will catch them.
    //
    // In strict mode: ALL issues cause exit 1 — missing sections, unfilled
    // placeholders, absent required lines, and invalid tier values.
    return (
      writeFailed ||
      (!fixStub && missingSections.length > 0) ||
      (!fixStub && unfilledPlaceholders.length > 0) ||
      (!fixStub && issues.some((i) => i.absent)) ||
      (!fixStub && unfixableIssues.length > 0) ||
      _patchFailures.length > 0
    );
  },
);

if (trueNonCompliant.length > 0) {
  const sectionNames = [...new Set(trueNonCompliant.flatMap((e) => e.missingSections))].join(", ");
  const hasValidationLineIssues = trueNonCompliant.some((e) => e.missingValidationLines.length > 0);
  console.error(
    `\ncheck-failure-gate — ${trueNonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan must:\n` +
      `  1. Contain all required sections: ${REQUIRED_SECTIONS.map((s) => `"${s.heading}"`).join(", ")}.\n` +
      (sectionNames ? `     Missing sections across files: ${sectionNames}.\n` : "") +
      `  2. Have no unfilled stub placeholders in the Validation section.\n` +
      `     Replace "<mid-weight tier for this project>" with the real command,\n` +
      `     "<replace with one-line justification>" with a real justification,\n` +
      `     and "<FILL IN>" with the real do-not-escalate rationale.\n` +
      `  3. Include a valid "**Command:**" line in the ## Validation section whose\n` +
      `     backtick-quoted value is one of: ${VALID_TIERS.map((t) => `\`${t}\``).join(", ")}.\n` +
      `  4. Include a "**Why:**" line in the ## Validation section.\n` +
      `  5. Include a "**Do not escalate:**" line in the ## Validation section.\n` +
      (hasValidationLineIssues ? `     See per-file listing above for details.\n` : "") +
      `Run with --fix-stub to insert missing lines automatically (invalid values must be corrected manually).`,
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
}
