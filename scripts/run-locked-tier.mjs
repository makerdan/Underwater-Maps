#!/usr/bin/env node
/**
 * run-locked-tier.mjs
 *
 * Mechanical tier-lock enforcement for the Failure Gate skill.
 *
 * Reads the **Command:** tier name from the ## Validation section of a plan
 * file, resolves it against VALIDATION_COMMANDS (the single source of truth),
 * and runs the registered command. The agent passes a plan file path — not a
 * tier name — so there is no substitution surface.
 *
 * Usage:
 *   node scripts/run-locked-tier.mjs <plan-file>
 *   node scripts/run-locked-tier.mjs --dry-run <plan-file>
 *
 * Flags:
 *   --dry-run   Print the resolved command and exit 0 without running it.
 *
 * Exit codes:
 *   0  — command ran and exited 0, or --dry-run succeeded
 *   1  — plan file missing / unreadable, ## Validation section absent,
 *         **Command:** line missing, or tier name not registered
 *   N  — the wrapped command's own exit code (pass-through)
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { VALIDATION_COMMANDS } from "./register-validation-commands.mjs";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");

if (positional.length === 0) {
  console.error(
    "run-locked-tier: missing plan file argument.\n" +
      "Usage: node scripts/run-locked-tier.mjs [--dry-run] <plan-file>",
  );
  process.exit(1);
}

const planFile = positional[0];

// ---------------------------------------------------------------------------
// Read plan file
// ---------------------------------------------------------------------------
let content;
try {
  content = readFileSync(planFile, "utf8");
} catch (err) {
  console.error(`run-locked-tier: cannot read plan file "${planFile}": ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extract the ## Validation section lines (same approach as check-failure-gate.mjs)
// ---------------------------------------------------------------------------
const lines = content.split("\n");
const valHeadingIdx = lines.findIndex((l) => l.trimEnd() === "## Validation");

if (valHeadingIdx === -1) {
  console.error(
    `run-locked-tier: "${planFile}" has no "## Validation" section.\n` +
      `Every plan must contain a ## Validation section with a **Command:** line.`,
  );
  process.exit(1);
}

// Collect lines belonging to the section (between heading and next ## or EOF)
const validationSectionLines = [];
for (let i = valHeadingIdx + 1; i < lines.length; i++) {
  if (lines[i].startsWith("## ")) break;
  validationSectionLines.push(lines[i]);
}

// ---------------------------------------------------------------------------
// Find the **Command:** line
// ---------------------------------------------------------------------------
const commandLine = validationSectionLines.find((l) =>
  l.trimStart().startsWith("**Command:**"),
);

if (!commandLine) {
  console.error(
    `run-locked-tier: "${planFile}" ## Validation section has no **Command:** line.\n` +
      `Add a **Command:** line with a backtick-quoted tier name, e.g. \`test-standard\`.`,
  );
  process.exit(1);
}

// Extract the backtick-quoted tier name
const m = commandLine.match(/\*\*Command:\*\*\s+`([^`]+)`/);
if (!m) {
  console.error(
    `run-locked-tier: **Command:** line in "${planFile}" does not contain a backtick-quoted tier name.\n` +
      `Found line: ${commandLine.trim()}\n` +
      `Expected format: **Command:** \`<tier-name>\``,
  );
  process.exit(1);
}

const tierName = m[1];

// ---------------------------------------------------------------------------
// Resolve against VALIDATION_COMMANDS (single source of truth)
// Tiered commands are those with a non-null budgetKey.
// ---------------------------------------------------------------------------
const tieredCommands = VALIDATION_COMMANDS.filter((c) => c.budgetKey !== null);
const entry = tieredCommands.find((c) => c.name === tierName);

if (!entry) {
  const validNames = tieredCommands.map((c) => c.name).join(", ");
  console.error(
    `run-locked-tier: "${tierName}" is not a registered tier name.\n` +
      `Valid tiers (from VALIDATION_COMMANDS): ${validNames}\n` +
      `Plan file: "${planFile}"`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Dry-run: print and exit
// ---------------------------------------------------------------------------
if (dryRun) {
  console.log(`run-locked-tier [--dry-run] resolved tier "${tierName}" → command:\n  ${entry.command}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run the command
// ---------------------------------------------------------------------------
console.log(`run-locked-tier: running tier "${tierName}"\n  ${entry.command}`);
const result = spawnSync(entry.command, { shell: true, stdio: "inherit" });
process.exit(result.status ?? 1);
