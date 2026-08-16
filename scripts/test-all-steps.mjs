#!/usr/bin/env node
/**
 * Layer 5 helper — runs the test-all step sequence with per-step wall-clock
 * timing so that, when the aggregate budget (tests/timeout-guard/budgets.json
 * → aggregate.totalBudgetMs, enforced by scripts/run-with-timeout.mjs) is
 * breached, the report can attribute time to the step that consumed it.
 *
 * Invoked by the root "test-all" script as:
 *   node scripts/run-with-timeout.mjs aggregate -- node scripts/test-all-steps.mjs
 *
 * Per-step resource locking: steps that declare a non-null `resource` in
 * scripts/validation-steps.mjs are wrapped in validation-lock.mjs (mirroring
 * run-tier.mjs's runStep()), so a `pnpm test-all` run cannot race a
 * workflow-based runner on shared resources (e.g. concurrent codegen
 * regenerating lib/api-zod/src/generated/api.ts). Steps with resource: null
 * run directly, without a lock, exactly as before.
 *
 * Per-step timing excludes lock-wait time: the lock wrapper's child
 * (run-tier.mjs --step) records a post-acquisition start timestamp into the
 * file named by VALIDATION_STEP_START_FILE, which this runner reads back.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getValidationSteps } from "./validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const lockScript = resolve(__dirname, "validation-lock.mjs");
const runTierScript = resolve(__dirname, "run-tier.mjs");

// Lock priority for test-all runs. Matches run-tier.mjs's TIER_PRIORITY.full
// (= 3): the full step sequence is the slowest consumer, so faster tiers
// (fast=1, standard=2) jump the queue ahead of it.
const LOCK_PRIORITY = 3;

// Canonical step list lives in scripts/validation-steps.mjs (shared with
// run-tier.mjs so the two runners cannot drift).
const steps = getValidationSteps("test-all");

const overallStart = Date.now();
const timings = [];

for (const step of steps) {
  console.log(`\n[test-all] ▶ step "${step.name}" starting (total elapsed ${((Date.now() - overallStart) / 1000).toFixed(0)}s)`);
  const { exitCode, startMs } = runStep(step);
  const secs = ((Date.now() - startMs) / 1000).toFixed(1);
  timings.push({ name: step.name, secs });
  console.log(`[test-all] ■ step "${step.name}" finished in ${secs}s (exit ${exitCode})`);
  if (exitCode !== 0) {
    printSummary();
    process.exit(exitCode);
  }
}

printSummary();

/**
 * Runs a step, wrapping it in validation-lock.mjs if the step declares a
 * resource (mirrors run-tier.mjs's runStep()). Returns the exit code plus the
 * timestamp at which the step's actual work started — for locked steps that
 * is after lock acquisition, so timings never include lock-wait time.
 *
 * @returns {{exitCode: number, startMs: number}}
 */
function runStep(step) {
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
    `test-all-step-start-${process.pid}-${step.name.replace(/[^a-zA-Z0-9-]/g, "-")}.txt`,
  );
  rmSync(stampFile, { force: true });
  const spawnStart = Date.now();
  const res = spawnSync(
    process.execPath,
    [
      lockScript,
      "--resource", step.resource,
      "--priority", String(LOCK_PRIORITY),
      "--",
      process.execPath, runTierScript,
      "--step", step.name,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, VALIDATION_STEP_START_FILE: stampFile },
    },
  );
  let startMs = spawnStart;
  try {
    const stamped = Number(readFileSync(stampFile, "utf8").trim());
    if (Number.isFinite(stamped) && stamped >= spawnStart) startMs = stamped;
  } catch { /* stamp missing (child died before writing) — fall back to spawn time */ }
  rmSync(stampFile, { force: true });
  return { exitCode: res.status ?? 1, startMs };
}

function execStep(step) {
  if (typeof step.cmd === "function") {
    return step.cmd();
  }
  const res = spawnSync(step.cmd, { shell: true, stdio: "inherit" });
  return res.status ?? 1;
}

function printSummary() {
  console.log("\n[test-all] step timing summary:");
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
}
