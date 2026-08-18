#!/usr/bin/env node
/**
 * Regression Guard lint guard — verifies that every plan file in .local/tasks/
 * contains a compliant `## Regression Guard` section.
 *
 * A section is compliant when it satisfies exactly ONE of:
 *   A) **Self-satisfying** declaration — the task's deliverable IS the test.
 *   B) **N/A** declaration — has **N/A** + **Why N/A:** with non-placeholder content.
 *   C) Filled template — has **Covers:**, **Test location:**, and **What it checks:**
 *      with non-placeholder content (no `<...>`, TBD, FILL IN).
 *
 * Run:  node scripts/check-regression-guard.mjs
 *
 * Flags:
 *   --fix-stub    For each plan file missing the section entirely, append a
 *                 minimal N/A stub that is itself compliant ("predates mandate").
 *                 Files that already have the section are never touched.
 *                 Always exits 0; safe to run unconditionally.
 *   --stubs-only  Skip the missing-section check; only report unfilled
 *                 placeholder text in existing ## Regression Guard sections.
 *                 Used to grandfather archives of older plan files that were
 *                 backfilled with the predates-mandate stub without breaking CI.
 *
 * Exit codes:
 *   0 — all files compliant (or no files found)
 *   1 — one or more files have a non-compliant ## Regression Guard section
 */

import { readdir, readFile, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

const TASKS_DIR = ".local/tasks";

// ---------------------------------------------------------------------------
// Stub appended by --fix-stub for files missing the section entirely.
// Uses a valid N/A declaration so it passes both --stubs-only and strict mode
// without requiring any human action — old plans are silently grandfathered.
// ---------------------------------------------------------------------------
const MISSING_SECTION_STUB = `
## Regression Guard
**N/A**
**Why N/A:** Plan predates the Regression Guard mandate — no retroactive regression test required.
`;

// ---------------------------------------------------------------------------
// Placeholder patterns — these make a field value non-compliant.
// Applied after stripping the field label (e.g. "**Covers:** ").
// ---------------------------------------------------------------------------
function isPlaceholder(text) {
  if (!text || text.trim() === "") return true;
  const t = text.trim();
  const lower = t.toLowerCase();
  // Angle-bracket template markers: whole-value token like <anything>
  // Mixed content like "renders <MyComponent /> correctly" is NOT a placeholder.
  if (t.startsWith("<") && t.endsWith(">")) return true;
  // Explicit placeholder keywords
  if (lower === "tbd") return true;
  if (lower.includes("fill in")) return true;
  if (lower === "todo") return true;
  if (lower === "n/a") return true; // bare N/A without Why N/A line
  return false;
}

// ---------------------------------------------------------------------------
// Check a single plan file's ## Regression Guard section.
// Returns { compliant: true } or { compliant: false, reason: string }.
// sectionLines: lines within the section (after the heading, before next ##).
// ---------------------------------------------------------------------------
function checkSection(sectionLines) {
  const lines = sectionLines.map((l) => l.trimStart()).filter((l) => l !== "");

  // (A) Self-satisfying declaration
  if (lines.some((l) => l.startsWith("**Self-satisfying**"))) {
    return { compliant: true };
  }

  // (B) N/A declaration
  const hasNA = lines.some((l) => l.startsWith("**N/A**"));
  if (hasNA) {
    const whyNALine = lines.find((l) => l.startsWith("**Why N/A:**"));
    if (!whyNALine) {
      return { compliant: false, reason: "has **N/A** but missing **Why N/A:** line" };
    }
    const value = whyNALine.slice("**Why N/A:**".length).trim();
    if (isPlaceholder(value)) {
      return {
        compliant: false,
        reason: `**Why N/A:** contains placeholder text: "${value}"`,
      };
    }
    return { compliant: true };
  }

  // (C) Filled template
  const REQUIRED_FIELDS = ["**Covers:**", "**Test location:**", "**What it checks:**"];
  const missing = [];
  const placeholder = [];

  for (const field of REQUIRED_FIELDS) {
    const line = lines.find((l) => l.startsWith(field));
    if (!line) {
      missing.push(field);
    } else {
      const value = line.slice(field.length).trim();
      if (isPlaceholder(value)) {
        placeholder.push(field);
      }
    }
  }

  if (missing.length > 0) {
    return {
      compliant: false,
      reason: `missing required field(s): ${missing.join(", ")}`,
    };
  }
  if (placeholder.length > 0) {
    return {
      compliant: false,
      reason: `placeholder text in field(s): ${placeholder.join(", ")}`,
    };
  }

  return { compliant: true };
}

// ---------------------------------------------------------------------------
// Extract the lines belonging to the ## Regression Guard section.
// Returns null if the section is absent.
// ---------------------------------------------------------------------------
function extractSection(allLines) {
  const headingIdx = allLines.findIndex(
    (l) => l.trimEnd() === "## Regression Guard",
  );
  if (headingIdx === -1) return null;

  const sectionLines = [];
  for (let i = headingIdx + 1; i < allLines.length; i++) {
    if (allLines[i].startsWith("## ")) break;
    sectionLines.push(allLines[i]);
  }
  return sectionLines;
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const fixStub = process.argv.includes("--fix-stub");
const stubsOnly = process.argv.includes("--stubs-only");
// --skip-if-no-task: exit 0 immediately when TASK_PLAN_FILE is not set.
// Used by the fast-tier validation steps so that ad-hoc / developer runs do
// not scan the full .local/tasks/ archive of 900+ pre-existing stubs.
const skipIfNoTask = process.argv.includes("--skip-if-no-task");

// ---------------------------------------------------------------------------
// Read plan files
//
// When TASK_PLAN_FILE is set (task-agent and CI environments always set it),
// restrict the check to that single file rather than scanning the full
// .local/tasks/ archive. This prevents hundreds of gitignored pre-existing
// plan files from blocking the fast tier in every fresh environment.
//
// When TASK_PLAN_FILE is not set (developer / manual run), the full archive
// scan proceeds as before.
// ---------------------------------------------------------------------------

const TASK_PLAN_FILE = process.env.TASK_PLAN_FILE;

// In single-file mode (task-agent or Planner verification run), always use
// strict mode regardless of --stubs-only. A plan actively being worked on
// is never "pre-mandate", so a missing section must be filled in.
if (TASK_PLAN_FILE && stubsOnly) {
  console.log(
    "check-regression-guard — single-file mode: overriding --stubs-only to strict.",
  );
}
const effectiveStubsOnly = stubsOnly && !TASK_PLAN_FILE;

let files;
/** Given an entry from `files`, return the filesystem path to read. */
let resolveFilePath;
/** Human-readable description of what was scanned, for the summary line. */
let scanDescription;

if (TASK_PLAN_FILE) {
  // Single-file mode ————————————————————————————————————————————————————
  console.log(`check-regression-guard — single-file mode: ${TASK_PLAN_FILE}`);

  if (!TASK_PLAN_FILE.endsWith(".md")) {
    console.error(
      `check-regression-guard — TASK_PLAN_FILE "${TASK_PLAN_FILE}" is not a .md file. Aborting.`,
    );
    process.exit(1);
  }

  if (!existsSync(TASK_PLAN_FILE)) {
    console.error(
      `check-regression-guard — TASK_PLAN_FILE "${TASK_PLAN_FILE}" does not exist. Aborting.`,
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
    console.log(
      "check-regression-guard — no TASK_PLAN_FILE set (--skip-if-no-task). Skipping. ✓",
    );
    process.exit(0);
  }

  // Archive mode — scan the full .local/tasks/ directory ——————————————————
  if (!existsSync(TASKS_DIR)) {
    console.log(
      `check-regression-guard — tasks directory "${TASKS_DIR}" does not exist. Nothing to check. ✓`,
    );
    process.exit(0);
  }

  try {
    const entries = await readdir(TASKS_DIR);
    files = entries.filter((f) => f.endsWith(".md")).sort();
  } catch (err) {
    console.error(
      `check-regression-guard — failed to read "${TASKS_DIR}": ${err.message}`,
    );
    process.exit(1);
  }

  if (files.length === 0) {
    console.log(
      `check-regression-guard — no .md files found in "${TASKS_DIR}". Nothing to check. ✓`,
    );
    process.exit(0);
  }

  resolveFilePath = (f) => join(TASKS_DIR, f);
  scanDescription = `"${TASKS_DIR}"`;
}

// ---------------------------------------------------------------------------
// Check each file
// ---------------------------------------------------------------------------
const compliant = []; // file names
const nonCompliant = []; // { file, reason, patched? }

for (const file of files) {
  const filePath = resolveFilePath(file);
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (err) {
    console.error(
      `check-regression-guard — could not read "${filePath}": ${err.message}`,
    );
    nonCompliant.push({ file, reason: `unreadable: ${err.message}` });
    continue;
  }

  const allLines = content.split("\n");
  const sectionLines = extractSection(allLines);

  // Section is absent
  if (sectionLines === null) {
    if (effectiveStubsOnly) {
      // Grandfathered — skip missing-section check.
      compliant.push(file);
      continue;
    }
    if (fixStub) {
      try {
        await appendFile(filePath, MISSING_SECTION_STUB, "utf8");
        console.warn(
          `check-regression-guard [--fix-stub] ⚠ patched "${file}" — appended predates-mandate N/A stub.`,
        );
        compliant.push(file); // stub is compliant (valid N/A)
      } catch (patchErr) {
        console.error(
          `check-regression-guard — failed to patch "${file}": ${patchErr.message}`,
        );
        nonCompliant.push({ file, reason: "missing ## Regression Guard section (patch failed)" });
      }
      continue;
    }
    // Strict mode: missing section is a violation.
    nonCompliant.push({ file, reason: "missing ## Regression Guard section" });
    continue;
  }

  // Section is present — check compliance.
  const result = checkSection(sectionLines);
  if (result.compliant) {
    compliant.push(file);
  } else {
    nonCompliant.push({ file, reason: result.reason });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  `\ncheck-regression-guard — scanned ${files.length} plan file(s) in ${scanDescription}:\n`,
);

// Only print per-file lines for non-compliant files (compliant list can be
// huge in an archive of hundreds of plan files — printing each would flood
// the output and bury the actionable errors).
for (const { file, reason } of nonCompliant) {
  console.log(`  ✗ ${file} — ${reason}`);
}
const patchedCount = fixStub
  ? nonCompliant.filter((e) => e.patched).length
  : 0;
const passCount = compliant.length;
console.log(
  `\ncheck-regression-guard — ${passCount}/${files.length} file(s) compliant.` +
    (patchedCount > 0 ? ` (${patchedCount} patched)` : "") +
    (nonCompliant.length === 0 ? " ✓" : ""),
);

// --fix-stub is documented as "always exits 0; safe to run unconditionally".
// Its job is only to insert stubs for missing sections; files with existing
// but unfilled sections are reported but do not cause a non-zero exit here —
// a subsequent strict-mode run is expected to catch those.
if (fixStub) {
  process.exit(0);
}

if (nonCompliant.length > 0) {
  console.error(
    `\ncheck-regression-guard — ${nonCompliant.length} non-compliant plan file(s) found.\n` +
      `Each plan's ## Regression Guard section must be ONE of:\n` +
      `  A) Self-satisfying: start with "**Self-satisfying**"\n` +
      `  B) N/A: "**N/A**" + "**Why N/A:** <specific reason>"\n` +
      `  C) Filled template: "**Covers:**", "**Test location:**", "**What it checks:**"\n` +
      `     — all three fields must contain real content, not placeholders (<...>, TBD, FILL IN).\n` +
      `Run with --fix-stub to insert a compliant N/A stub for any file missing the section entirely\n` +
      `(files with an existing section but unfilled fields must be corrected manually).`,
  );
  process.exit(1);
}

process.exit(0);
