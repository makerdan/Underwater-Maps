#!/usr/bin/env node
/**
 * check-lock-skill-sync.mjs — Drift guard between validation-lock.mjs and the
 * Port-Authority skill documentation.
 *
 * The Port-Authority skill documents the CLI flags and reentrancy env-var
 * contract of scripts/validation-lock.mjs. This check ensures those named
 * identifiers still appear in the script so documentation drift is caught on
 * every test-fast run instead of silently accumulating.
 *
 * What we check: a curated list of "anchor terms" — flag names, env-var
 * prefixes, and feature keywords — that the skill explicitly documents. If any
 * term disappears from validation-lock.mjs, the skill is now inaccurate and
 * this check fails loudly with a remediation hint.
 *
 * Each anchor may use either:
 *   term    — literal substring that must appear
 *   pattern — RegExp that must match (used when a substring test would produce
 *             false negatives, e.g. when one anchor name is a prefix of another)
 *
 * Usage:
 *   node scripts/check-lock-skill-sync.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const LOCK_SCRIPT = resolve(root, "scripts/validation-lock.mjs");

/**
 * Anchor terms extracted from Port-Authority skill Phase 4 documentation.
 * Each entry has:
 *   term | pattern — what to search for (literal string or RegExp)
 *   label          — human-readable name shown in the failure message
 *   hint           — short remediation guidance
 *
 * Keep this list in sync with the Phase 4 section of:
 *   .agents/skills/Port-Authority/SKILL.md
 *   .local/custom_skills/port-authority/SKILL.md
 */
const ANCHORS = [
  {
    term: "--resource",
    label: "--resource flag",
    hint: 'Add or restore the --resource <name> CLI flag in validation-lock.mjs and update Port-Authority SKILL.md if the flag was intentionally renamed.',
  },
  {
    term: "--priority",
    label: "--priority flag",
    hint: 'Add or restore the --priority <1-9> CLI flag in validation-lock.mjs and update Port-Authority SKILL.md if the flag was intentionally renamed.',
  },
  {
    term: "VALIDATION_LOCK_HELD_PID_",
    label: "VALIDATION_LOCK_HELD_PID_<RESOURCE> reentrancy env-var prefix",
    hint: 'The per-resource reentrancy env var (VALIDATION_LOCK_HELD_PID_<RESOURCE_UPPER>) is documented in Port-Authority SKILL.md. Restore it in validation-lock.mjs or update the skill if the mechanism changed.',
  },
  {
    // Use a pattern rather than a literal term: "VALIDATION_LOCK_HELD_PID" is a
    // prefix of "VALIDATION_LOCK_HELD_PID_", so a plain includes() check would
    // pass even if the legacy var were removed and only the prefixed form remained.
    // Require the name to be followed by a non-underscore character (space, quote,
    // bracket, or line-end) so only the bare legacy var matches.
    pattern: /VALIDATION_LOCK_HELD_PID[^_]/,
    label: "VALIDATION_LOCK_HELD_PID legacy global reentrancy env-var",
    hint: 'The legacy VALIDATION_LOCK_HELD_PID var (for the "global" resource) is documented in Port-Authority SKILL.md. Restore it in validation-lock.mjs or update the skill if the mechanism changed.',
  },
];

let source;
try {
  source = readFileSync(LOCK_SCRIPT, "utf8");
} catch (err) {
  console.error(`[check-lock-skill-sync] ERROR: cannot read ${LOCK_SCRIPT}: ${err.message}`);
  console.error("  → Ensure scripts/validation-lock.mjs exists. It is documented in Port-Authority SKILL.md.");
  process.exit(1);
}

function anchorPresent(anchor) {
  if (anchor.pattern) return anchor.pattern.test(source);
  return source.includes(anchor.term);
}

function anchorDisplay(anchor) {
  return anchor.pattern ? anchor.pattern.toString() : JSON.stringify(anchor.term);
}

const failures = [];
for (const anchor of ANCHORS) {
  if (!anchorPresent(anchor)) {
    failures.push(anchor);
  }
}

if (failures.length === 0) {
  console.log(`[check-lock-skill-sync] OK — all ${ANCHORS.length} Port-Authority anchor terms present in validation-lock.mjs`);
  process.exit(0);
}

console.error(`[check-lock-skill-sync] FAIL — ${failures.length} anchor term(s) missing from scripts/validation-lock.mjs:\n`);
for (const anchor of failures) {
  console.error(`  Missing: ${anchorDisplay(anchor)}  (${anchor.label})`);
  console.error(`  Fix:     ${anchor.hint}\n`);
}
console.error(
  "If the lock script was intentionally refactored, update ANCHORS in\n" +
  "scripts/check-lock-skill-sync.mjs AND update Port-Authority SKILL.md\n" +
  "(.agents/skills/Port-Authority/SKILL.md and .local/custom_skills/port-authority/SKILL.md)\n" +
  "so the documentation stays accurate.",
);
process.exit(1);
