#!/usr/bin/env node
/**
 * run-tier.mjs — tiered validation runner.
 *
 * Usage:
 *   node scripts/run-tier.mjs fast       # typecheck + lint + static checks (~5 min)
 *   node scripts/run-tier.mjs standard   # fast tier + unit + doc/catalog/schema checks (~20 min)
 *   node scripts/run-tier.mjs full       # all steps, identical to test-all-steps.mjs (~45 min)
 *
 * NOTE: The step list is shared with scripts/test-all-steps.mjs via
 * scripts/validation-steps.mjs — the single source of truth, so the two
 * runners cannot drift.
 *
 * Per-step named resource locking is handled internally; the outer caller
 * does NOT need to wrap this in validation-lock.mjs. Only steps that actually
 * conflict (codegen races, CPU saturation) acquire a lock; lightweight steps
 * run without any lock.
 *
 * Single-step mode (used by the lock wrapper itself):
 *   node scripts/run-tier.mjs --step <name>
 *
 * Step skipping (used by test-heavy-serial.mjs so its PREFLIGHT can run the
 * standard tier without duplicating test:unit, which the heavy runner runs
 * itself with its own locking):
 *   node scripts/run-tier.mjs standard --skip test:unit
 *
 * Budget keys in tests/timeout-guard/budgets.json:
 *   tierFast     → 5 min
 *   tierStandard → 20 min
 *   aggregate    → 45 min (reused for "full")
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getValidationSteps, getStepsForTier } from "./validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const lockScript = resolve(__dirname, "validation-lock.mjs");

const VALID_TIERS = ["fast", "standard", "full"];

// Tier-based priority passed to validation-lock.mjs for lock acquisition.
// Lower number = higher priority = jumps the queue over slower tiers.
const TIER_PRIORITY = { fast: 1, standard: 2, full: 3 };

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

// --step mode is handled later (after ALL_STEPS is initialised); skip tier
// validation for that path so we don't emit a spurious "invalid tier" error.
const isStepMode = args.includes("--step");
// --check-tier-only: run only the tier-lock pre-check and exit, without
// executing any validation steps. Used by tests to verify checkTierLock()
// in isolation without triggering a full validation run.
const checkTierOnly = args.includes("--check-tier-only");
const tier = args[0];
if (!isStepMode && (!tier || !VALID_TIERS.includes(tier))) {
  console.error(`Usage: run-tier.mjs <fast|standard|full> [--skip <step> ...]\nGot: ${JSON.stringify(tier)}`);
  process.exit(2);
}

// --skip <name> (repeatable): omit named steps from the tier run. Used by
// test-heavy-serial.mjs to run the standard tier without test:unit.
const skippedSteps = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--skip") {
    const name = args[i + 1];
    if (!name) {
      console.error("Usage: run-tier.mjs <tier> --skip <step-name>");
      process.exit(2);
    }
    skippedSteps.push(name);
    i++;
  }
}

// ---------------------------------------------------------------------------
// Tier-lock pre-check (automatic Failure Gate enforcement)
//
// When TASK_PLAN_FILE is set, reads the plan's ## Validation section via
// run-locked-tier.mjs --dry-run and verifies the tier named there matches
// the tier being run.  This catches accidental escalation without requiring
// the agent to remember to call run-locked-tier.mjs manually.
//
// When TASK_PLAN_FILE is not set (e.g. ad-hoc or non-task CI calls), a one-
// line warning is printed and execution continues — graceful degradation.
//
// Skipped in --step mode (the inner re-entrant invocation from the lock
// wrapper) to avoid recursive checking.
// ---------------------------------------------------------------------------

if (!isStepMode) {
  checkTierLock(tier);
  // --check-tier-only: exit now without running any validation steps.
  // checkTierLock() itself calls process.exit(1) on a TIER-LOCK VIOLATION,
  // so reaching this point means the check passed (or gracefully degraded).
  if (checkTierOnly) process.exit(0);
}

/**
 * Verifies the plan-file tier ceiling matches the tier argument being run.
 * Always exits gracefully (warn + return) when the plan file is absent or
 * unparseable — only exits 1 on a provable tier mismatch.
 *
 * @param {string} requestedTier - the run-tier.mjs arg ("fast"|"standard"|"full")
 */
function checkTierLock(requestedTier) {
  const planFile = process.env.TASK_PLAN_FILE;

  if (!planFile) {
    console.warn(
      "[run-tier] WARNING: TASK_PLAN_FILE is not set — automatic tier-lock enforcement skipped.\n" +
        "           Set TASK_PLAN_FILE=<path-to-plan> to enforce the tier ceiling from the plan file.",
    );
    return; // graceful degradation for non-task runs
  }

  // Resolve the plan's tier via run-locked-tier.mjs --dry-run so that
  // parsing logic stays in a single place and cannot drift.
  const dryResult = spawnSync(
    process.execPath,
    [resolve(__dirname, "run-locked-tier.mjs"), "--dry-run", planFile],
    { encoding: "utf8" },
  );

  if (dryResult.status === 2) {
    // Exit 2 means run-locked-tier found the plan file but it has no
    // ## Validation section — old plan that predates the convention.
    // Graceful degradation: warn and continue without enforcement.
    console.warn(
      `[run-tier] WARNING: tier-lock pre-check skipped — "${planFile}" has no ## Validation section.\n` +
        `           ${(dryResult.stderr || dryResult.stdout || "").trim()}`,
    );
    return;
  }

  if (dryResult.status !== 0) {
    // Exit 1 (or any other nonzero code): plan file exists but tier name is
    // missing, malformed, or not registered — treat as a TIER-LOCK VIOLATION.
    console.error(
      `[run-tier] TIER-LOCK VIOLATION: plan file "${planFile}" could not be resolved to a valid tier.\n` +
        `           ${(dryResult.stderr || dryResult.stdout || "").trim()}\n` +
        `           Fix the **Command:** line in the plan's ## Validation section before running.`,
    );
    process.exit(1);
  }

  // run-locked-tier prints: run-locked-tier [--dry-run] resolved tier "X" → command: ...
  const m = (dryResult.stdout || "").match(/resolved tier "([^"]+)"/);
  if (!m) {
    console.warn(
      `[run-tier] WARNING: tier-lock pre-check output was not parseable — skipping ceiling check.`,
    );
    return;
  }

  const lockedTierName = m[1]; // e.g. "test-standard"

  // Map VALIDATION_COMMANDS tier names → run-tier.mjs tier arguments.
  // test-heavy routes through test-heavy-serial.mjs which ultimately runs
  // the full step set, so it maps to "full" here.
  const TIER_NAME_TO_ARG = {
    "test-fast": "fast",
    "test-standard": "standard",
    "test-standard-plus": "full",
    "test-heavy": "full",
  };
  const expectedArg = TIER_NAME_TO_ARG[lockedTierName] ?? lockedTierName;

  if (expectedArg !== requestedTier) {
    console.error(
      `[run-tier] TIER-LOCK VIOLATION: plan requires "${lockedTierName}" (run-tier arg: "${expectedArg}") ` +
        `but this run is using tier "${requestedTier}".\n` +
        `           Use: node scripts/run-locked-tier.mjs <plan-file>\n` +
        `           to let the plan file choose the tier automatically.\n` +
        `           Plan file: "${planFile}"`,
    );
    process.exit(1);
  }

  console.log(
    `[run-tier] tier-lock pre-check passed — plan "${planFile}" requires "${lockedTierName}" ✓`,
  );
}

// ---------------------------------------------------------------------------
// Step registry — canonical list lives in scripts/validation-steps.mjs
// (shared with test-all-steps.mjs so the two runners cannot drift).
// ---------------------------------------------------------------------------

const ALL_STEPS = getValidationSteps("run-tier");

// ---------------------------------------------------------------------------
// Single-step mode: node run-tier.mjs --step <name>
// Runs the named step directly without any locking (the lock wrapper calls us
// this way so locking is controlled at the outer level).
// NOTE: This block must appear AFTER ALL_STEPS is initialised — accessing
// ALL_STEPS before its const declaration runs is a TDZ error in ESM.
// ---------------------------------------------------------------------------

const stepIdx = args.indexOf("--step");
if (stepIdx !== -1) {
  const stepName = args[stepIdx + 1];
  if (!stepName) {
    console.error("Usage: run-tier.mjs --step <name>");
    process.exit(2);
  }
  // runSingleStep() always calls process.exit(exitCode) itself and never
  // returns, so no exit call is needed (or reachable) after it.
  runSingleStep(stepName);
}

// ---------------------------------------------------------------------------
// Single-step runner (used by --step mode and inline for no-resource steps)
// ALL_STEPS is now initialised — safe to reference it here.
// ---------------------------------------------------------------------------

function runSingleStep(name) {
  const step = ALL_STEPS.find((s) => s.name === name);
  if (!step) {
    console.error(`[run-tier] unknown step name: ${JSON.stringify(name)}`);
    process.exit(2);
  }
  // --step mode only runs after the outer lock wrapper has acquired the
  // resource lock. When the invoking runner (test-all-steps.mjs) asks for a
  // post-acquisition start timestamp — so its per-step timing excludes
  // lock-wait time — record it now.
  if (process.env.VALIDATION_STEP_START_FILE) {
    try {
      writeFileSync(process.env.VALIDATION_STEP_START_FILE, String(Date.now()));
    } catch { /* best-effort — caller falls back to spawn-start timing */ }
  }
  const exitCode = execStep(step);
  process.exit(exitCode);
}

function execStep(step) {
  if (typeof step.cmd === "function") {
    return step.cmd();
  }
  const res = spawnSync(step.cmd, { shell: true, stdio: "inherit" });
  return res.status ?? 1;
}

// ---------------------------------------------------------------------------
// Locked step runner
// ---------------------------------------------------------------------------

/**
 * Runs a step, wrapping it in validation-lock.mjs if the step declares a
 * resource. Returns the exit code plus the timestamp at which the step's
 * actual work started — for locked steps that is after lock acquisition, so
 * timings never include lock-wait time (mirrors test-all-steps.mjs).
 *
 * @returns {{exitCode: number, startMs: number}}
 */
function runStep(step, tierPriority) {
  if (!step.resource) {
    const startMs = Date.now();
    return { exitCode: execStep(step), startMs };
  }

  // Steps with resources are invoked via the lock wrapper which calls back
  // into run-tier.mjs in --step mode to execute the actual work. The child
  // writes its post-acquisition start time into stampFile so elapsed-time
  // logging starts after lock acquisition, not during the wait.
  const stampFile = join(
    tmpdir(),
    `run-tier-step-start-${process.pid}-${step.name.replace(/[^a-zA-Z0-9-]/g, "-")}.txt`,
  );
  rmSync(stampFile, { force: true });
  const spawnStart = Date.now();
  const lockCmd = [
    process.execPath, lockScript,
    "--resource", step.resource,
    "--priority", String(tierPriority),
    "--",
    process.execPath, resolve(__dirname, "run-tier.mjs"),
    "--step", step.name,
  ];
  const res = spawnSync(lockCmd[0], lockCmd.slice(1), {
    stdio: "inherit",
    env: { ...process.env, VALIDATION_STEP_START_FILE: stampFile },
  });
  let startMs = spawnStart;
  try {
    const stamped = Number(readFileSync(stampFile, "utf8").trim());
    if (Number.isFinite(stamped) && stamped >= spawnStart) startMs = stamped;
  } catch { /* stamp missing (child died before writing) — fall back to spawn time */ }
  rmSync(stampFile, { force: true });
  return { exitCode: res.status ?? 1, startMs };
}

// ---------------------------------------------------------------------------
// Tier runner
// ---------------------------------------------------------------------------

// Tier membership is declared explicitly per step (tiers array) in
// scripts/validation-steps.mjs; getStepsForTier throws if any step lacks a
// tier assignment, so a new step can never silently run in zero tiers.
let steps = getStepsForTier(ALL_STEPS, tier);
if (skippedSteps.length > 0) {
  for (const name of skippedSteps) {
    if (!ALL_STEPS.some((s) => s.name === name)) {
      console.error(`[run-tier] --skip: unknown step name: ${JSON.stringify(name)}`);
      process.exit(2);
    }
  }
  steps = steps.filter((s) => !skippedSteps.includes(s.name));
  console.log(`[run-tier] skipping step(s): ${skippedSteps.join(", ")}`);
}
const tierPriority = TIER_PRIORITY[tier];

console.log(`\n[run-tier] tier="${tier}" priority=${tierPriority} — running ${steps.length} step(s): ${steps.map((s) => s.name).join(", ")}`);

const overallStart = Date.now();
const timings = [];

for (const step of steps) {
  const loopNow = Date.now();
  console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
  const { exitCode, startMs } = runStep(step, tierPriority);
  const secs = ((Date.now() - startMs) / 1000).toFixed(1);
  timings.push({ name: step.name, secs });
  console.log(`[run-tier] ■ step "${step.name}" finished in ${secs}s (exit ${exitCode})`);
  if (exitCode !== 0) {
    printSummary();
    process.exit(exitCode);
  }
}

printSummary();

function printSummary() {
  console.log(`\n[run-tier] tier="${tier}" step timing summary:`);
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
}
