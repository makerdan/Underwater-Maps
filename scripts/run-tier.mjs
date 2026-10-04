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
 * Write a complete JSON per-step run report (including steps not reached):
 *   node scripts/run-tier.mjs standard --report <path>
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
import { cleanStaleValidationLocks } from "./clean-stale-validation-locks.mjs";
import { checkTestDependencies } from "./lib/check-test-dependencies.mjs";
import { collectTestCaseDiscovery } from "./failure-gate-v4/test-case-report.mjs";
import { ENGINE_EVIDENCE_STEPS } from "./failure-gate-v4/engine-evidence.mjs";
import {
  createStepRecord,
  createStepReport,
  parseReportOption,
  writeStepReport,
} from "./lib/step-report.mjs";

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

let reportPath = null;
let args;
try {
  ({ argv: args, reportPath } = parseReportOption(process.argv.slice(2)));
} catch (error) {
  console.error(`[run-tier] ${error.message}`);
  process.exit(2);
}
reportPath ??= process.env.VALIDATION_REPORT_FILE || null;

// --step mode is handled later (after ALL_STEPS is initialised); skip tier
// validation for that path so we don't emit a spurious "invalid tier" error.
const isStepMode = args.includes("--step");
// --check-tier-only: run only the tier-lock pre-check and exit, without
// executing any validation steps. Used by tests to verify checkTierLock()
// in isolation without triggering a full validation run.
const checkTierOnly = args.includes("--check-tier-only");
// --allow-no-plan remains accepted for compatibility with older ad-hoc and
// heavy-preflight callers. It does not grant task authorization; callers
// without TASK_PLAN_FILE are independent diagnostics either way.
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
// When TASK_PLAN_FILE is not set, this shared runner treats the invocation as
// an independent diagnostic. It is not task-validation evidence. The explicit
// task-validation entry point binds and validates its plan before launch.
// Any supplied plan that cannot be read/parsed or whose tier mismatches is a
// hard violation, regardless of caller flags.
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
  try {
    checkTestDependencies(root);
  } catch (error) {
    console.error(`[run-tier] dependency preflight failed: ${error.message}`);
    process.exit(1);
  }
  if (tier === "fast") reclaimOrphanedLocksBeforeFastTier();
}

/**
 * Clear lock files left by a validation wrapper that is no longer running
 * before the fast tier reaches its first resource-backed step. The cleanup
 * implementation performs its own atomic generation and staleness checks, so
 * a live holder's lock remains protected even if it races this preflight.
 *
 * A lock-directory read failure is fatal: continuing would make the fast tier
 * indistinguishable from a run that successfully checked for orphaned locks.
 */
function reclaimOrphanedLocksBeforeFastTier() {
  const lockDir = process.env.VALIDATION_LOCK_FILE
    ? dirname(resolve(process.env.VALIDATION_LOCK_FILE))
    : resolve(root, ".local");
  try {
    const result = cleanStaleValidationLocks(lockDir, {
      log: (message) => console.log(`[run-tier] ${message}`),
      errorLog: (message) => console.error(`[run-tier] ${message}`),
    });
    if (result.removed.length > 0) {
      console.log(
        `[run-tier] fast-tier lock preflight reclaimed ${result.removed.length} orphaned lock(s)`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[run-tier] fast-tier lock preflight failed; refusing to start validation: ${message}`,
    );
    process.exit(1);
  }
}

/**
 * Verifies the plan-file tier ceiling matches the tier argument being run.
 *
 * When TASK_PLAN_FILE is absent, classify the call as an independent
 * diagnostic. It may execute, but it is not task-validation evidence.
 *
 * A supplied plan that is malformed, unreadable, or mismatched fails closed
 * before any validation step starts.
 *
 * @param {string}  requestedTier - the run-tier.mjs arg ("fast"|"standard"|"full")
 */
function checkTierLock(requestedTier) {
  const planFile = process.env.TASK_PLAN_FILE;
  const result = runTierLockDryRun(planFile);

  if (result.kind === "no-plan-file") {
    console.warn(
      "[run-tier] INDEPENDENT DIAGNOSTIC: TASK_PLAN_FILE is not set; " +
        "this invocation is not task-validation evidence.",
    );
    return;
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
    console.error(
      `[run-tier] TIER-LOCK VIOLATION: tier-lock pre-check output was not parseable.\n` +
        `           A task-driven run cannot bypass the plan ceiling when tier data is unavailable.\n` +
        `           Fix the plan or tier-lock tooling before running validation.`,
    );
    process.exit(1);
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
  const { exitCode } = execStep(step);
  process.exit(exitCode);
}

function execStep(step) {
  if (typeof step.cmd === "function") {
    const exitCode = step.cmd();
    return { exitCode, rawExitStatus: exitCode, signal: null };
  }
  const res = spawnSync(step.cmd, {
    shell: true,
    stdio: "inherit",
    env: stepEnvironment(step),
  });
  return {
    exitCode: res.status ?? 1,
    rawExitStatus: res.status,
    signal: res.signal ?? null,
  };
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
    return { ...execStep(step), startMs };
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
    env: { ...stepEnvironment(step), VALIDATION_STEP_START_FILE: stampFile },
  });
  let startMs = spawnStart;
  try {
    const stamped = Number(readFileSync(stampFile, "utf8").trim());
    if (Number.isFinite(stamped) && stamped >= spawnStart) startMs = stamped;
  } catch { /* stamp missing (child died before writing) — fall back to spawn time */ }
  rmSync(stampFile, { force: true });
  return { exitCode: res.status ?? 1, rawExitStatus: res.status, signal: res.signal ?? null, startMs };
}

// ---------------------------------------------------------------------------
// Tier runner
// ---------------------------------------------------------------------------

// Tier membership is declared explicitly per step (tiers array) in
// scripts/validation-steps.mjs; getStepsForTier throws if any step lacks a
// tier assignment, so a new step can never silently run in zero tiers.
const tierSteps = getStepsForTier(ALL_STEPS, tier);
let steps = tierSteps;
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
const reportStartedAt = new Date(overallStart).toISOString();
const timings = [];
const reportSteps = tierSteps.map((step) => createStepRecord({
  name: step.name,
  phase: "tier",
  status: skippedSteps.includes(step.name) ? "skipped" : "not_reached",
  reason: skippedSteps.includes(step.name) ? "explicitly skipped by --skip" : null,
}));
const reportStepByName = new Map(reportSteps.map((step) => [step.name, step]));

if (tier === "full") {
  await runFullTier();
} else {
  for (const step of steps) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const result = runStep(step, tierPriority);
    recordStep(step, result);
    const { exitCode } = result;
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      await printSummary();
      process.exit(exitCode);
    }
  }
}

await printSummary();

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
      const result = runStep(step, tierPriority);
      recordStep(step, result);
      const { exitCode } = result;
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
    const result = runStep(step, tierPriority);
    recordStep(step, result);
    const { exitCode } = result;
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
    const result = runStep(step, tierPriority);
    recordStep(step, result);
    const { exitCode } = result;
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
    recordStep(result.step, result);
    if (result.exitCode !== 0) firstFailure ||= result.exitCode;
  }

  for (const step of steps.slice(unitIndex + 1)) {
    const loopNow = Date.now();
    console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((loopNow - overallStart) / 1000).toFixed(0)}s)`);
    const result = runStep(step, tierPriority);
    recordStep(step, result);
    const { exitCode } = result;
    if (exitCode !== 0) firstFailure ||= exitCode;
  }
  if (firstFailure) process.exitCode = firstFailure;
}

function recordStep(step, result) {
  const { exitCode, rawExitStatus, signal, startMs } = result;
  const finishedMs = Date.now();
  const secs = ((finishedMs - startMs) / 1000).toFixed(1);
  timings.push({ name: step.name, secs });
  Object.assign(reportStepByName.get(step.name), {
    status: exitCode === 0 ? "passed" : "failed",
    rawExitStatus,
    signal,
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startMs),
  });
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
      env: { ...stepEnvironment(step), VALIDATION_STEP_START_FILE: stampFile },
    });
    child.once("exit", (code) => {
      let startMs = spawnStart;
      try {
        const stamped = Number(readFileSync(stampFile, "utf8").trim());
        if (Number.isFinite(stamped) && stamped >= spawnStart) startMs = stamped;
      } catch { /* child died before writing — use spawn time */ }
      rmSync(stampFile, { force: true });
      resolveResult({
        step,
        exitCode: code ?? 1,
        rawExitStatus: code,
        signal: child.signalCode ?? null,
        startMs,
      });
    });
    child.once("error", () => resolveResult({
      step,
      exitCode: 1,
      rawExitStatus: null,
      signal: null,
      startMs: spawnStart,
    }));
  });
}

function stepEnvironment(step) {
  const env = {
    ...process.env,
    // Reporter step context is owned by this runner, never inherited from a
    // fixture or caller-provided FAILURE_GATE_TEST_STEP value.
    FAILURE_GATE_TEST_STEP: ENGINE_EVIDENCE_STEPS.includes(step.name) ? step.name : "",
  };
  if (step.name === "test:unit") env.FAILURE_GATE_TEST_CASE_SUITE = "scripts-unit";
  return env;
}

async function printSummary() {
  console.log(`\n[run-tier] tier="${tier}" step timing summary:`);
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
  if (reportPath) {
    const testCases = await collectTestCaseDiscovery(
      process.env.FAILURE_GATE_TEST_CASE_REPORT_DIR,
      { required: steps.some((step) => ["test:unit", "test:e2e", "e2e-palette"].includes(step.name)) },
    );
    const finishedAt = new Date().toISOString();
    const report = createStepReport({
      runner: "run-tier",
      tier,
      startedAt: reportStartedAt,
      finishedAt,
      rawExitStatus: process.exitCode ?? 0,
      discovery: {
        registeredSteps: {
          available: true,
          source: "scripts/validation-steps.mjs",
          names: tierSteps.map((step) => step.name),
        },
        testCases,
      },
      steps: reportSteps,
    });
    writeStepReport(reportPath, report);
    console.log(`[run-tier] machine-readable report written to ${resolve(reportPath)}`);
  }
}
