#!/usr/bin/env node
/**
 * run-tier.mjs — tiered validation runner.
 *
 * Usage:
 *   node scripts/run-tier.mjs fast       # typecheck + lint (~5 min)
 *   node scripts/run-tier.mjs standard   # typecheck + lint + unit + doc/catalog checks (~20 min)
 *   node scripts/run-tier.mjs full       # all 10 steps, identical to test-all-steps.mjs (~45 min)
 *
 * Per-step named resource locking is handled internally; the outer caller
 * does NOT need to wrap this in validation-lock.mjs. Only steps that actually
 * conflict (codegen races, CPU saturation) acquire a lock; lightweight steps
 * run without any lock.
 *
 * Single-step mode (used by the lock wrapper itself):
 *   node scripts/run-tier.mjs --step <name>
 *
 * Budget keys in tests/timeout-guard/budgets.json:
 *   tierFast     → 5 min
 *   tierStandard → 20 min
 *   aggregate    → 45 min (reused for "full")
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

// Single-step mode: node run-tier.mjs --step <name>
// Runs the named step directly without any locking (the lock wrapper calls us
// this way so locking is controlled at the outer level).
const stepIdx = args.indexOf("--step");
if (stepIdx !== -1) {
  const stepName = args[stepIdx + 1];
  if (!stepName) {
    console.error("Usage: run-tier.mjs --step <name>");
    process.exit(2);
  }
  runSingleStep(stepName);
  process.exit(0);
}

const tier = args[0];
if (!tier || !VALID_TIERS.includes(tier)) {
  console.error(`Usage: run-tier.mjs <fast|standard|full>\nGot: ${JSON.stringify(tier)}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Codegen freshness check
// ---------------------------------------------------------------------------

/**
 * Returns true when the generated api.ts is newer than all codegen inputs
 * (openapi.yaml and orval.config.ts), meaning codegen can be safely skipped.
 */
function isCodegenFresh() {
  const generatedFile = resolve(root, "lib/api-zod/src/generated/api.ts");
  const inputs = [
    resolve(root, "lib/api-spec/openapi.yaml"),
    resolve(root, "lib/api-spec/orval.config.ts"),
  ];
  try {
    const generatedMtime = statSync(generatedFile).mtimeMs;
    for (const input of inputs) {
      if (statSync(input).mtimeMs >= generatedMtime) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the typecheck step with a freshness-aware codegen pre-pass.
 * Returns exit code.
 */
function runTypecheckStep() {
  if (isCodegenFresh()) {
    console.log("[run-tier] codegen is fresh — skipping");
  } else {
    const codegenRes = spawnSync(
      "pnpm --filter @workspace/api-spec run codegen:generate",
      { shell: true, stdio: "inherit" },
    );
    if (codegenRes.status !== 0) {
      return codegenRes.status ?? 1;
    }
  }

  const typecheckRes = spawnSync(
    'pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" --filter "./scripts" --if-present run typecheck',
    { shell: true, stdio: "inherit" },
  );
  return typecheckRes.status ?? 1;
}

// ---------------------------------------------------------------------------
// Step registry
//
// Each step entry:
//   name      — display name and --step key
//   resource  — named lock resource to acquire (null = run without lock)
//   cmd       — shell command string, or a function returning exit code
// ---------------------------------------------------------------------------

/** @type {Array<{name: string, resource: string|null, cmd: string|Function}>} */
const ALL_STEPS = [
  // codegen resource: prevents concurrent api.ts regeneration
  { name: "typecheck", resource: "codegen", cmd: runTypecheckStep },
  // no resource: lint is read-only and does not conflict with anything
  { name: "lint", resource: null, cmd: "pnpm run lint" },
  // unit-cpu resource: prevents CPU saturation / budget breach
  { name: "test:unit", resource: "unit-cpu", cmd: "pnpm run test:unit" },
  // all check:* steps are lightweight; no resource needed
  { name: "check:docs-stale", resource: null, cmd: "pnpm run check:docs-stale" },
  { name: "check:catalog-coverage", resource: null, cmd: "pnpm run check:catalog-coverage" },
  { name: "check:e2e-user-ids", resource: null, cmd: "pnpm run check:e2e-user-ids" },
  { name: "check:e2e-cjs-globals", resource: null, cmd: "pnpm run check:e2e-cjs-globals" },
  { name: "check:fixture-freshness", resource: null, cmd: "pnpm run check:fixture-freshness" },
  { name: "check:ports", resource: null, cmd: "pnpm run check:ports" },
  { name: "check:audit", resource: null, cmd: "pnpm run check:audit" },
];

const TIER_STEPS = {
  fast:     ALL_STEPS.slice(0, 2),
  standard: ALL_STEPS.slice(0, 5),
  full:     ALL_STEPS,
};

// ---------------------------------------------------------------------------
// Single-step runner (used by --step mode and inline for no-resource steps)
// ---------------------------------------------------------------------------

function runSingleStep(name) {
  const step = ALL_STEPS.find((s) => s.name === name);
  if (!step) {
    console.error(`[run-tier] unknown step name: ${JSON.stringify(name)}`);
    process.exit(2);
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
 * resource. Returns the exit code.
 */
function runStep(step, tierPriority) {
  if (!step.resource) {
    return execStep(step);
  }

  // Steps with resources are invoked via the lock wrapper which calls back
  // into run-tier.mjs in --step mode to execute the actual work.
  const lockCmd = [
    process.execPath, lockScript,
    "--resource", step.resource,
    "--priority", String(tierPriority),
    "--",
    process.execPath, resolve(__dirname, "run-tier.mjs"),
    "--step", step.name,
  ];
  const res = spawnSync(lockCmd[0], lockCmd.slice(1), { stdio: "inherit" });
  return res.status ?? 1;
}

// ---------------------------------------------------------------------------
// Tier runner
// ---------------------------------------------------------------------------

const steps = TIER_STEPS[tier];
const tierPriority = TIER_PRIORITY[tier];

console.log(`\n[run-tier] tier="${tier}" priority=${tierPriority} — running ${steps.length} step(s): ${steps.map((s) => s.name).join(", ")}`);

const overallStart = Date.now();
const timings = [];

for (const step of steps) {
  const start = Date.now();
  console.log(`\n[run-tier] ▶ step "${step.name}" starting (total elapsed ${((start - overallStart) / 1000).toFixed(0)}s)`);
  const exitCode = runStep(step, tierPriority);
  const secs = ((Date.now() - start) / 1000).toFixed(1);
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
