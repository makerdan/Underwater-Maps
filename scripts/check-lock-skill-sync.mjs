#!/usr/bin/env node
/**
 * check-lock-skill-sync.mjs — Drift guard between Port-Authority skill
 * documentation and the two scripts it describes.
 *
 * Phase 4 (validation-lock.mjs) — checked against scripts/validation-lock.mjs
 * Phase 2 (free-ports / kill-port-holders) — checked against scripts/kill-port-holders.mjs
 *
 * The Port-Authority skill documents the CLI flags and reentrancy env-var
 * contract of scripts/validation-lock.mjs, and the non-negotiable properties
 * of the canonical port-cleanup script (scripts/kill-port-holders.mjs, which
 * fulfils the role of the skill's "scripts/free-ports.mjs" template). This
 * check ensures those named identifiers still appear in each script so
 * documentation drift is caught on every test-fast run instead of silently
 * accumulating.
 *
 * What we check: a curated list of "anchor terms" — flag names, env-var
 * prefixes, function names, and feature keywords — that the skill explicitly
 * documents. If any term disappears from its target script, the skill is now
 * inaccurate and this check fails loudly with a remediation hint.
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
const FREE_PORTS_SCRIPT = resolve(root, "scripts/kill-port-holders.mjs");

// ---------------------------------------------------------------------------
// Anchor definitions
// ---------------------------------------------------------------------------

/**
 * Anchor terms for scripts/validation-lock.mjs.
 * Extracted from Port-Authority skill Phase 4 documentation.
 *
 * Keep this list in sync with the Phase 4 section of:
 *   .agents/skills/Port-Authority/SKILL.md
 *   .local/custom_skills/port-authority/SKILL.md
 */
const LOCK_ANCHORS = [
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

/**
 * Anchor terms for scripts/kill-port-holders.mjs (the project's free-ports
 * implementation; fulfils the role of the skill's "scripts/free-ports.mjs"
 * template). Extracted from Port-Authority skill Phase 2 documentation.
 *
 * The five non-negotiable Phase 2 properties documented by the skill:
 *   1. No fuser — "do not rely on fuser" (often missing from PATH under Nix)
 *   2. /proc fd scanning — discover holders via socket inode matching, not names
 *   3. Own-tree exemption — walk parent PIDs to avoid killing own run's servers
 *   4. SIGTERM→SIGKILL sequence — graceful then forced termination, port confirm
 *   5. Env-guard — KILL_PORT_HOLDERS_RUNNING prevents recursive/production calls
 *
 * Keep this list in sync with the Phase 2 section of:
 *   .agents/skills/Port-Authority/SKILL.md
 *   .local/custom_skills/port-authority/SKILL.md
 */
const FREE_PORTS_ANCHORS = [
  {
    term: "fuser",
    label: 'no-fuser guarantee (Phase 2: "do not rely on fuser")',
    hint: 'The skill documents that the port-cleanup script must not rely on fuser (often absent under Nix). Restore the fuser-avoidance comment/guard in kill-port-holders.mjs, or update Port-Authority SKILL.md if the approach changed.',
  },
  {
    term: "/proc/net/tcp",
    label: '/proc fd scanning for socket inode discovery (Phase 2: "discover holders via /proc fd scanning")',
    hint: 'The skill documents /proc/net/tcp socket-inode scanning as the holder-discovery method. Restore it in kill-port-holders.mjs, or update Port-Authority SKILL.md if the approach changed.',
  },
  {
    term: "selfAncestors",
    label: 'own-tree exemption via parent-PID walk (Phase 2: "exempt the caller\'s own process tree by walking parent PIDs")',
    hint: 'The skill documents that the port-cleanup script must exempt its own process tree by walking parent PIDs. Restore the selfAncestors() function (or equivalent) in kill-port-holders.mjs, or update Port-Authority SKILL.md if the mechanism changed.',
  },
  {
    term: "SIGTERM",
    label: 'SIGTERM→SIGKILL sequence (Phase 2: "SIGTERM first with a grace period, then SIGKILL survivors")',
    hint: 'The skill documents a SIGTERM-first graceful termination with SIGKILL escalation. Restore the SIGTERM/SIGKILL sequence in kill-port-holders.mjs, or update Port-Authority SKILL.md if the approach changed.',
  },
  {
    term: "SIGKILL",
    label: 'SIGKILL escalation step (Phase 2: "then SIGKILL survivors, then confirm the port is actually free")',
    hint: 'The skill documents SIGKILL escalation after SIGTERM grace expires. Restore the SIGKILL step in kill-port-holders.mjs, or update Port-Authority SKILL.md if the approach changed.',
  },
  {
    term: "KILL_PORT_HOLDERS_RUNNING",
    label: 'env-guard against recursive or production execution (Phase 2: "guard with an environment variable")',
    hint: 'The skill documents an env-guard that prevents recursive or production invocation. Restore the KILL_PORT_HOLDERS_RUNNING env-var check in kill-port-holders.mjs, or update Port-Authority SKILL.md if the mechanism changed.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readScript(scriptPath, label) {
  try {
    return readFileSync(scriptPath, "utf8");
  } catch (err) {
    console.error(`[check-lock-skill-sync] ERROR: cannot read ${scriptPath}: ${err.message}`);
    console.error(`  → Ensure ${label} exists. It is documented in Port-Authority SKILL.md.`);
    process.exit(1);
  }
}

function anchorPresent(source, anchor) {
  if (anchor.pattern) return anchor.pattern.test(source);
  return source.includes(anchor.term);
}

function anchorDisplay(anchor) {
  return anchor.pattern ? anchor.pattern.toString() : JSON.stringify(anchor.term);
}

function checkAnchors(source, anchors) {
  const failures = [];
  for (const anchor of anchors) {
    if (!anchorPresent(source, anchor)) {
      failures.push(anchor);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Run checks
// ---------------------------------------------------------------------------

const lockSource = readScript(LOCK_SCRIPT, "scripts/validation-lock.mjs");
const freePortsSource = readScript(FREE_PORTS_SCRIPT, "scripts/kill-port-holders.mjs");

const lockFailures = checkAnchors(lockSource, LOCK_ANCHORS, "validation-lock.mjs");
const freePortsFailures = checkAnchors(freePortsSource, FREE_PORTS_ANCHORS, "kill-port-holders.mjs");

const totalAnchors = LOCK_ANCHORS.length + FREE_PORTS_ANCHORS.length;
const totalFailures = lockFailures.length + freePortsFailures.length;

if (totalFailures === 0) {
  console.log(
    `[check-lock-skill-sync] OK — all ${totalAnchors} Port-Authority anchor terms present` +
    ` (${LOCK_ANCHORS.length} in validation-lock.mjs, ${FREE_PORTS_ANCHORS.length} in kill-port-holders.mjs)`,
  );
  process.exit(0);
}

console.error(`[check-lock-skill-sync] FAIL — ${totalFailures} anchor term(s) missing:\n`);

if (lockFailures.length > 0) {
  console.error(`  scripts/validation-lock.mjs (${lockFailures.length} missing):`);
  for (const anchor of lockFailures) {
    console.error(`    Missing: ${anchorDisplay(anchor)}  (${anchor.label})`);
    console.error(`    Fix:     ${anchor.hint}\n`);
  }
}

if (freePortsFailures.length > 0) {
  console.error(`  scripts/kill-port-holders.mjs (${freePortsFailures.length} missing):`);
  for (const anchor of freePortsFailures) {
    console.error(`    Missing: ${anchorDisplay(anchor)}  (${anchor.label})`);
    console.error(`    Fix:     ${anchor.hint}\n`);
  }
}

console.error(
  "If a script was intentionally refactored, update LOCK_ANCHORS / FREE_PORTS_ANCHORS in\n" +
  "scripts/check-lock-skill-sync.mjs AND update Port-Authority SKILL.md\n" +
  "(.agents/skills/Port-Authority/SKILL.md and .local/custom_skills/port-authority/SKILL.md)\n" +
  "so the documentation stays accurate.",
);
process.exit(1);
