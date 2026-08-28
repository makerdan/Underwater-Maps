#!/usr/bin/env node
/**
 * new-plan.mjs — Scaffolding helper for plan files in .local/tasks/.
 *
 * Creates a new plan stub with BOTH required sections pre-filled so that
 * `node scripts/check-failure-gate.mjs` exits 0 immediately — no manual
 * backfill step required.
 *
 * Usage:
 *   node scripts/new-plan.mjs <task-ref> --title "Task title" --why "One-line justification" [--tier test-standard]
 *
 * Required arguments:
 *   <task-ref>          Numeric task reference (e.g. 4020). The file is
 *                       written to .local/tasks/task-<ref>.md.
 *   --title <text>      Short descriptive title for the plan heading.
 *   --why <text>        One-line justification for the Validation **Why:** line.
 *                       Must be real text — not the placeholder string. The
 *                       script refuses to write a file until this is filled in.
 *
 * Optional arguments:
 *   --tier <tier>       Validation tier (default: test-standard). Must be one
 *                       of the project's registered valid tier names.
 *   --pre-existing <text>
 *                       One-line description of a known baseline failure this
 *                       task may ignore. May be repeated.
 *   --owned-baseline <text>
 *                       One-line description of a known baseline failure this
 *                       validation-repair task explicitly owns and must fix.
 *                       May be repeated. Omit when no failures are known.
 *   --out <path>        Override the output path (default: .local/tasks/task-<ref>.md).
 *   --dry-run           Print the generated content without writing to disk.
 *
 * Exit codes:
 *   0 — file written (or printed in --dry-run mode)
 *   1 — missing required argument, invalid tier, or file already exists
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { VALIDATION_COMMANDS } from "./register-validation-commands.mjs";

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);

function getFlag(flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const val = args[idx + 1];
  return val && !val.startsWith("--") ? val : null;
}

function getRepeatedFlag(flag) {
  const results = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      results.push(args[i + 1]);
    }
  }
  return results;
}

const taskRef = args.find((a) => /^\d+$/.test(a)) ?? null;
const title = getFlag("--title");
const why = getFlag("--why");
const tier = getFlag("--tier") ?? "test-standard";
const outOverride = getFlag("--out");
const preExistingEntries = getRepeatedFlag("--pre-existing");
const ownedBaselineEntries = getRepeatedFlag("--owned-baseline");
const dryRun = args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Known placeholder strings that --why must NOT contain
const WHY_PLACEHOLDERS = [
  "<replace with one-line justification>",
  "<one-line justification",
  "Placeholder — review before running this task",
];

let hasErrors = false;

if (!taskRef) {
  console.error("new-plan: ERROR — missing required argument: <task-ref> (a numeric task number)");
  hasErrors = true;
}

if (!title) {
  console.error("new-plan: ERROR — missing required argument: --title <text>");
  hasErrors = true;
}

if (!why) {
  console.error(
    "new-plan: ERROR — missing required argument: --why <text>\n" +
      "  Provide a one-line justification for why this validation tier covers the task scope.\n" +
      "  Example: --why 'covers all changed scripts/* files via typecheck + lint'",
  );
  hasErrors = true;
} else {
  const lowerWhy = why.toLowerCase();
  const isPlaceholder = WHY_PLACEHOLDERS.some((p) => lowerWhy.includes(p.toLowerCase()));
  if (isPlaceholder) {
    console.error(
      `new-plan: ERROR — --why must contain real text, not a placeholder string.\n` +
        `  Got: "${why}"\n` +
        `  Provide a genuine one-line justification instead.`,
    );
    hasErrors = true;
  }
}

// Validate tier against registered valid tiers
const VALID_TIERS = VALIDATION_COMMANDS.filter((c) => c.budgetKey !== null).map((c) => c.name);
if (!VALID_TIERS.includes(tier)) {
  console.error(
    `new-plan: ERROR — --tier "${tier}" is not a valid registered tier.\n` +
      `  Valid tiers: ${VALID_TIERS.join(", ")}`,
  );
  hasErrors = true;
}

if (hasErrors) {
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Determine output path
// ---------------------------------------------------------------------------
const TASKS_DIR = ".local/tasks";
const outPath = outOverride ?? join(TASKS_DIR, `task-${taskRef}.md`);

if (!dryRun && existsSync(outPath)) {
  console.error(
    `new-plan: ERROR — file already exists: ${outPath}\n` +
      `  Delete it first or use --out to specify a different path.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build the pre-existing failures section
// ---------------------------------------------------------------------------
let preExistingSection;
if (preExistingEntries.length > 0 || ownedBaselineEntries.length > 0) {
  const ignoredBullets = preExistingEntries.map((e) => `- **Ignored baseline:** ${e}`);
  const ownedBullets = ownedBaselineEntries.map(
    (e) => `- **Owned baseline repair:** ${e} — this task must fix it.`,
  );
  const bullets = [...ignoredBullets, ...ownedBullets].join("\n");
  preExistingSection =
    `## Pre-existing failures to ignore\n` +
    `These failures exist on \`main\` before this task starts. Each bullet explicitly\n` +
    `states whether this task may ignore the failure or owns its repair.\n\n` +
    `${bullets}\n\n` +
    `**Flaky-test rule:** If a test not listed above fails, retry it 3× in isolation\n` +
    `to determine whether it is intermittent. A passing retry establishes\n` +
    `intermittency, not pre-existing provenance. Use the Failure Gate evidence\n` +
    `rules before assigning ownership.\n\n` +
    `Before completion, fix every **Owned baseline repair**. Remaining **Ignored\n` +
    `baseline** failures and evidence-backed self-classifications may be reported\n` +
    `without unrelated repair work.`;
} else {
  preExistingSection =
    `## Pre-existing failures to ignore\n` +
    `None known at plan time. Treat every failure as a potential regression.\n\n` +
    `**Flaky-test rule:** If a test fails, retry it 3× in isolation to determine\n` +
    `whether it is intermittent. A passing retry establishes intermittency, not\n` +
    `pre-existing provenance. Use the Failure Gate evidence rules before assigning\n` +
    `ownership.`;
}

// ---------------------------------------------------------------------------
// Build the validation section
// ---------------------------------------------------------------------------
const validationSection =
  `## Validation\n` +
  `**Command:** \`${tier}\`\n` +
  `**Why:** ${why}\n` +
  `**Do not escalate:** Run exactly this command. Pre-existing failures are\n` +
  `handled above — they are never a reason to run a heavier tier.`;

// ---------------------------------------------------------------------------
// Build the regression guard section
// ---------------------------------------------------------------------------
// Uses **Self-satisfying** by default so the file passes check:regression-guard
// immediately.  Replace with the appropriate classification before marking
// the task complete:
//
//   Self-satisfying — the task's deliverable IS the test (describe it briefly).
//   N/A             — **N/A** + **Why N/A:** <specific reason, no placeholders>.
//   Covered         — **Covers:** / **Test location:** / **What it checks:**
//                     (all three fields must contain real content).
const regressionGuardSection =
  `## Regression Guard\n` +
  `**Self-satisfying**\n` +
  `<!-- Replace before marking complete. Options:\n` +
  `  **Self-satisfying** — the task deliverable IS the regression test (add a brief description).\n` +
  `  **N/A** + **Why N/A:** <specific reason this change needs no separate regression test>.\n` +
  `  **Covers:** <what> / **Test location:** <file> / **What it checks:** <behaviour> -->`;

// ---------------------------------------------------------------------------
// Assemble plan content
// ---------------------------------------------------------------------------
const content =
  `# Task #${taskRef}: ${title}\n\n` +
  `## Steps\n` +
  `<!-- Fill in implementation steps before starting work -->\n\n` +
  `${preExistingSection}\n\n` +
  `${regressionGuardSection}\n\n` +
  `${validationSection}\n`;

// ---------------------------------------------------------------------------
// Write or print
// ---------------------------------------------------------------------------
if (dryRun) {
  console.log(`--- dry-run: would write to ${outPath} ---\n`);
  console.log(content);
  console.log(`--- end ---`);
  process.exit(0);
}

try {
  await mkdir(TASKS_DIR, { recursive: true });
  await writeFile(outPath, content, { encoding: "utf8", flag: "wx" }); // wx = exclusive create
  console.log(`new-plan: ✓ created ${outPath}`);
  console.log(`  Title: ${title}`);
  console.log(`  Tier:  ${tier}`);
  console.log(`  Why:   ${why}`);
  console.log(`\n  Next: fill in the ## Steps section and add any pre-existing failures.`);
  console.log(`  Verify: node scripts/check-failure-gate.mjs`);
} catch (err) {
  if (err.code === "EEXIST") {
    console.error(`new-plan: ERROR — file already exists: ${outPath}`);
  } else {
    console.error(`new-plan: ERROR — failed to write ${outPath}: ${err.message}`);
  }
  process.exit(1);
}
