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
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getValidationSteps, getStepsForTier } from "./validation-steps.mjs";
import { runTierLockDryRun } from "./lib/tier-lock-check.mjs";

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
// --allow-no-plan: when present, a missing TASK_PLAN_FILE reverts to the old
// warn-and-continue behaviour instead of a hard error.  Intended ONLY for
// legitimate non-task callers such as ad-hoc developer runs and the internal
// preflight inside test-heavy-serial.mjs (which strips TASK_PLAN_FILE after
// its own outer tier-lock check has already passed).
// Task-driven invocations MUST NOT pass this flag — they always have
// TASK_PLAN_FILE set.
const allowNoPlan = args.includes("--allow-no-plan");
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
  checkTierLock(tier, allowNoPlan);
  // --check-tier-only: exit now without running any validation steps.
  // checkTierLock() itself calls process.exit(1) on a TIER-LOCK VIOLATION,
  // so reaching this point means the check passed (or gracefully degraded).
  if (checkTierOnly) process.exit(0);
}

/**
 * Verifies the plan-file tier ceiling matches the tier argument being run.
 *
 * When TASK_PLAN_FILE is absent:
 *   - allowNoPlan=true  → warn + return (graceful degradation for ad-hoc runs)
 *   - allowNoPlan=false → TIER-LOCK VIOLATION + exit 1 (task invocations must
 *                         always set TASK_PLAN_FILE)
 *
 * For all other result kinds (tier mismatch, unparseable, etc.) the behaviour
 * is unchanged from before.
 *
 * @param {string}  requestedTier - the run-tier.mjs arg ("fast"|"standard"|"full")
 * @param {boolean} [allowNoPlan=false] - pass true for non-task callers that
 *   legitimately omit TASK_PLAN_FILE (e.g. `--allow-no-plan` flag)
 */
function checkTierLock(requestedTier, allowNoPlan = false) {
  const planFile = process.env.TASK_PLAN_FILE;
  const result = runTierLockDryRun(planFile);

  if (result.kind === "no-plan-file") {
    if (allowNoPlan) {
      console.warn(
        "[run-tier] WARNING: TASK_PLAN_FILE is not set — automatic tier-lock enforcement skipped.\n" +
          "           (--allow-no-plan flag is set; this is expected for ad-hoc / non-task runs.)",
      );
      return; // graceful degradation: caller explicitly opted out
    }
    // Task-driven invocations must always have TASK_PLAN_FILE set.
    console.error(
      "[run-tier] TIER-LOCK VIOLATION: TASK_PLAN_FILE is not set.\n" +
        "           Every task-driven validation run must set TASK_PLAN_FILE=<path-to-plan>.\n" +
        "           For ad-hoc non-task runs, pass --allow-no-plan to opt out of this check.\n" +
        "           Example: node scripts/run-tier.mjs fast --allow-no-plan",
    );
    process.exit(1);
  }

  if (result.kind === "violation") {
    // Plan file exists but tier name is missing, malformed, or not registered.
    console.error(
      `[run-tier] TIER-LOCK VIOLATION: plan file "${planFile}" could not be resolved to a valid tier.\n` +
        `           ${result.output}\n` +
        `           Fix the **Command:** line in the plan's ## Validation section before running.`,
    );
    process.exit(1);
  }

  if (result.kind === "unparseable") {
    console.warn(
      `[run-tier] WARNING: tier-lock pre-check output was not parseable — skipping ceiling check.`,
    );
    return;
  }

  const lockedTierName = result.tierName; // e.g. "test-standard"

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

if (tier === "full") {
  await runFullTier();
} else {
  for (const step of steps) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const { exitCode, startMs } = runStep(step, tierPriority);
    recordStep(step, exitCode, startMs);
    if (exitCode !== 0) {
      printSummary();
      process.exit(exitCode);
    }
  }
}

printSummary();

/**
 * The full static tier is commonly run by a managed validation lifecycle that
 * is shorter than its local timeout budget.  Typecheck/codegen must remain
 * first, but the inexpensive checks after it can safely run alongside the
 * unit suite.  The checks after test:unit stay serial and therefore still
 * run after unit validation, even when the unit suite fails.
 */
async function runFullTier() {
  const unitIndex = steps.findIndex((step) => step.name === "test:unit");
  if (unitIndex === -1) {
    // Keep --skip test:unit useful for ad-hoc callers and the heavy-run
    // preflight, even though the normal full tier always includes the step.
    for (const step of steps) {
      const loopNow = Date.now();
      console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
      const { exitCode, startMs } = runStep(step, tierPriority);
      recordStep(step, exitCode, startMs);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
        break;
      }
    }
    return;
  }

  let firstFailure = 0;
  const preUnitSteps = steps.slice(0, unitIndex);
  for (const step of preUnitSteps.filter((candidate) => candidate.name === "typecheck")) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const { exitCode, startMs } = runStep(step, tierPriority);
    recordStep(step, exitCode, startMs);
    if (exitCode !== 0) firstFailure ||= exitCode;
  }

  // These steps can write the same plan file, and the strict checks depend on
  // their output. Keep this small safety chain serial while the rest overlaps
  // with test:unit below.
  const serializedPreUnitNames = new Set([
    "fix:failure-gate-stubs",
    "check:failure-gate",
    "fix:regression-guard-stubs",
    "check:regression-guard",
  ]);
  for (const step of preUnitSteps.filter(
    (candidate) => serializedPreUnitNames.has(candidate.name),
  )) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const { exitCode, startMs } = runStep(step, tierPriority);
    recordStep(step, exitCode, startMs);
    if (exitCode !== 0) firstFailure ||= exitCode;
  }

  const parallelSteps = [
    steps[unitIndex],
    ...preUnitSteps.filter(
      (step) =>
        step.name !== "typecheck" && !serializedPreUnitNames.has(step.name),
    ),
  ];
  console.log(
    `\n[run-tier] overlapping ${parallelSteps.length} pre-unit step(s) with "test:unit"; ` +
      "post-unit safeguards remain ordered after unit validation",
  );
  const parallelResults = await Promise.all(
    parallelSteps.map((step) => runStepAsync(step, tierPriority)),
  );
  for (const result of parallelResults) {
    recordStep(result.step, result.exitCode, result.startMs);
    if (result.exitCode !== 0) firstFailure ||= result.exitCode;
  }

  for (const step of steps.slice(unitIndex + 1)) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const { exitCode, startMs } = runStep(step, tierPriority);
    recordStep(step, exitCode, startMs);
    if (exitCode !== 0) firstFailure ||= exitCode;
  }
  if (firstFailure) process.exitCode = firstFailure;
}

function recordStep(step, exitCode, startMs) {
  const secs = ((Date.now() - startMs) / 1000).toFixed(1);
  timings.push({ name: step.name, secs });
  console.log(`[run-tier] ■ step "${step.name}" finished in ${secs}s (exit ${exitCode})`);
}

/**
 * Async counterpart to runStep(), used only for the safe pre-unit overlap.
 * It mirrors the same resource-lock command and post-lock timing stamp.
 */
function runStepAsync(step, tierPriority) {
  const stampFile = join(
    tmpdir(),
    `run-tier-async-step-start-${process.pid}-${step.name.replace(/[^a-zA-Z0-9-]/g, "-")}.txt`,
  );
  rmSync(stampFile, { force: true });
  const spawnStart = Date.now();
  const lockArgs = step.resource
    ? [
        lockScript,
        "--resource", step.resource,
        "--priority", String(tierPriority),
        "--",
        process.execPath, resolve(__dirname, "run-tier.mjs"),
        "--step", step.name,
      ]
    : null;
  const command = lockArgs ? process.execPath : step.cmd;
  const args = lockArgs ? lockArgs : [];
  console.log(`\n[run-tier] ▶ step "${step.name}" starting concurrently`);

  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      shell: !lockArgs,
      stdio: "inherit",
      env: { ...process.env, VALIDATION_STEP_START_FILE: stampFile },
    });
    child.once("exit", (code) => {
      let startMs = spawnStart;
      try {
        const stamped = Number(readFileSync(stampFile, "utf8").trim());
        if (Number.isFinite(stamped) && stamped >= spawnStart) startMs = stamped;
      } catch { /* child died before writing — use spawn time */ }
      rmSync(stampFile, { force: true });
      resolveResult({ step, exitCode: code ?? 1, startMs });
    });
    child.once("error", () => resolveResult({ step, exitCode: 1, startMs: spawnStart }));
  });
}

function printSummary() {
  console.log(`\n[run-tier] tier="${tier}" step timing summary:`);
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
}
