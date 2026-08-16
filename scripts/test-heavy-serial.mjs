#!/usr/bin/env node
/**
 * Serialized runner for the full heavy validation tier (lint/typecheck
 * preflight + unit + palette e2e + full e2e).
 *
 * Structure:
 *   1. PREFLIGHT (fail-fast): runs `run-tier.mjs standard --skip test:unit`
 *      which covers typecheck, lint, check:lock-skill-sync,
 *      check:root-relative-api, check:deps-suppression, check:docs-stale,
 *      check:catalog-coverage, and check:schema-stale (test:unit is skipped
 *      because the heavy runner runs it itself below with its own locking).
 *      If any of these fail the script exits immediately — no point spending
 *      45 min on unit/e2e suites when the code doesn't even typecheck or lint.
 *
 *   2. HEAVY SUITES (no-fail-fast): test:unit, e2e-palette, test:e2e run one
 *      after another so a single validation pass reports every failing suite.
 *      The exit code is non-zero if any suite failed.
 *
 * Running the heavy suites in parallel overloads the machine and causes
 * timeout-guard budget breaches with no real test failures, so they run
 * serially with port sweeps between them.
 *
 * Per-step named resource locking is used so the individual suites do not
 * race for CPU or e2e ports even when this serial runner is invoked
 * concurrently from multiple validation commands:
 *   test:unit   → unit-cpu resource (priority 3)
 *   e2e-palette → unit-cpu + e2e-port resources (priority 3)
 *   test:e2e    → unit-cpu + e2e-port resources (priority 3)
 *
 * Invoked by the "test-heavy" validation workflow.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTierLockDryRun } from "./lib/tier-lock-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockScript = resolve(root, "scripts/validation-lock.mjs");
const timeoutScript = resolve(root, "scripts/run-with-timeout.mjs");
mkdirSync(resolve(root, ".local/tmp"), { recursive: true });

// --allow-no-plan: when present, a missing TASK_PLAN_FILE reverts to the old
// warn-and-continue behaviour instead of a hard error.  Intended ONLY for
// legitimate non-task callers such as ad-hoc developer runs.
// Task-driven invocations MUST NOT pass this flag.
const allowNoPlan = process.argv.includes("--allow-no-plan");

// ---------------------------------------------------------------------------
// Tier-lock pre-check (automatic Failure Gate enforcement)
//
// When TASK_PLAN_FILE is set, reads the plan's ## Validation section via
// run-locked-tier.mjs --dry-run and verifies the tier named there is
// "test-heavy". This catches accidental escalation to the heavy runner when
// the plan only permitted a lighter tier — a plan ceiling of test-standard
// should never silently run a 45-min heavy suite.
//
// When TASK_PLAN_FILE is not set (e.g. ad-hoc or non-task CI calls), a one-
// line warning is printed and execution continues — graceful degradation.
// ---------------------------------------------------------------------------

{
  const planFile = process.env.TASK_PLAN_FILE;
  const result = runTierLockDryRun(planFile);

  if (result.kind === "no-plan-file") {
    if (allowNoPlan) {
      console.warn(
        "[test-heavy] WARNING: TASK_PLAN_FILE is not set — automatic tier-lock enforcement skipped.\n" +
          "             (--allow-no-plan flag is set; this is expected for ad-hoc / non-task runs.)",
      );
    } else {
      // Task-driven invocations must always have TASK_PLAN_FILE set.
      console.error(
        "[test-heavy] TIER-LOCK VIOLATION: TASK_PLAN_FILE is not set.\n" +
          "             Every task-driven validation run must set TASK_PLAN_FILE=<path-to-plan>.\n" +
          "             For ad-hoc non-task runs, pass --allow-no-plan to opt out of this check.\n" +
          "             Example: node scripts/test-heavy-serial.mjs --allow-no-plan",
      );
      process.exit(1);
    }
  } else if (result.kind === "no-validation-section") {
    // Plan file exists but has no ## Validation section — old plan that
    // predates the convention. Graceful degradation: warn and continue.
    console.warn(
      `[test-heavy] WARNING: tier-lock pre-check skipped — "${planFile}" has no ## Validation section.\n` +
        `             ${result.output}`,
    );
  } else if (result.kind === "violation") {
    // Plan exists but tier name is missing, malformed, or not registered.
    console.error(
      `[test-heavy] TIER-LOCK VIOLATION: plan file "${planFile}" could not be resolved to a valid tier.\n` +
        `             ${result.output}\n` +
        `             Fix the **Command:** line in the plan's ## Validation section before running.`,
    );
    process.exit(1);
  } else if (result.kind === "unparseable") {
    console.warn(
      `[test-heavy] WARNING: tier-lock pre-check output was not parseable — skipping ceiling check.`,
    );
  } else {
    const lockedTierName = result.tierName; // e.g. "test-standard"
    if (lockedTierName !== "test-heavy") {
      console.error(
        `[test-heavy] TIER-LOCK VIOLATION: plan requires "${lockedTierName}" but the heavy runner was invoked.\n` +
          `             The heavy runner ("test-heavy") must only be used when the plan's ## Validation\n` +
          `             section specifies **Command:** \`test-heavy\`.\n` +
          `             Use: node scripts/run-locked-tier.mjs <plan-file>\n` +
          `             to let the plan file choose the tier automatically.\n` +
          `             Plan file: "${planFile}"`,
      );
      process.exit(1);
    }
    console.log(
      `[test-heavy] tier-lock pre-check passed — plan "${planFile}" requires "${lockedTierName}" ✓`,
    );
  }
}

/**
 * Build a command array that wraps <cmd> with one or more named resource
 * locks at the given priority (nesting them for multi-resource steps).
 * The innermost lock wraps the actual command; outer locks wrap each other.
 *
 *   wrapWithLocks(["pnpm", "run", "test:e2e"], ["unit-cpu", "e2e-port"], 3)
 *   →  validation-lock --resource unit-cpu --priority 3 --
 *        validation-lock --resource e2e-port --priority 3 --
 *          pnpm run test:e2e
 */
function wrapWithLocks(cmd, resources, priority) {
  if (!resources || resources.length === 0) return cmd;
  let wrapped = cmd;
  for (const resource of [...resources].reverse()) {
    wrapped = [
      process.execPath, lockScript,
      "--resource", resource,
      "--priority", String(priority),
      "--",
      ...wrapped,
    ];
  }
  return wrapped;
}

/**
 * Wrap <cmd> with a Layer 4 per-step run budget using run-with-timeout.mjs.
 * This is applied INSIDE the lock wrappers so the budget timer starts only
 * after the lock is acquired, attributing hangs to the specific step rather
 * than to lock-wait time.
 */
function wrapWithTimeout(cmd, budgetKey, label) {
  return [
    process.execPath, timeoutScript,
    budgetKey,
    "--label", label,
    "--",
    ...cmd,
  ];
}

const HEAVY_PRIORITY = 3;

// ---------------------------------------------------------------------------
// PREFLIGHT: typecheck + lint + static checks (fail-fast)
// Run before the expensive suites so obvious errors surface early rather
// than after 45 min.  run-tier.mjs standard --skip test:unit covers:
//   typecheck, lint, check:lock-skill-sync, check:root-relative-api,
//   check:deps-suppression, check:docs-stale, check:catalog-coverage,
//   check:schema-stale
// test:unit is skipped here because the heavy runner runs it below with its
// own resource locking — running it twice would waste ~25 min per heavy run.
// ---------------------------------------------------------------------------

const runTierScript = resolve(root, "scripts/run-tier.mjs");
const preflightStart = Date.now();
console.log("\n[test-heavy] ▶ PREFLIGHT: typecheck + lint + static checks (run-tier.mjs standard --skip test:unit)");
// Strip TASK_PLAN_FILE from the preflight environment. The outer tier-lock
// check above has already verified that the plan authorises test-heavy. The
// internal preflight deliberately runs a lighter tier (standard, minus
// test:unit) as a fail-fast gate — it is NOT a second entry point from the
// outside and must not be re-validated against the plan's ceiling.
const preflightEnv = { ...process.env };
delete preflightEnv.TASK_PLAN_FILE;
const preflightRes = spawnSync(
  process.execPath,
  // --allow-no-plan is required here: TASK_PLAN_FILE was stripped from
  // preflightEnv above, so the internal standard-tier preflight run is a
  // legitimate non-task invocation that must not hard-error on the missing
  // env var.  The outer tier-lock check above has already verified that the
  // plan authorises test-heavy before we reach this point.
  [runTierScript, "standard", "--skip", "test:unit", "--allow-no-plan"],
  { stdio: "inherit", cwd: root, env: preflightEnv },
);
const preflightCode = preflightRes.status ?? 1;
const preflightSecs = ((Date.now() - preflightStart) / 1000).toFixed(1);
console.log(`[test-heavy] ■ PREFLIGHT finished in ${preflightSecs}s (exit ${preflightCode})`);
if (preflightCode !== 0) {
  console.error("[test-heavy] PREFLIGHT failed — aborting before heavy suites. Fix typecheck/lint errors first.");
  process.exit(preflightCode);
}

const steps = [
  {
    // No per-step wrapWithTimeout here: `pnpm run test:unit` runs ALL
    // packages' unit suites (api-server + bathyscan + lib-db, up to ~30 min
    // combined), so no single per-suite budget key fits. Each package's
    // vitest run enforces its own runBudgetMs internally, and the combined
    // step is covered by the outer `aggregate` budget on the whole heavy run.
    name: "test:unit",
    cmd: wrapWithLocks(
      ["pnpm", "run", "test:unit"],
      ["unit-cpu"],
      HEAVY_PRIORITY,
    ),
  },
  {
    name: "e2e-palette",
    cmd: wrapWithLocks(
      wrapWithTimeout(
        [
          "bash", "-c",
          "set -o pipefail; E2E_WEB_PORT=3250 E2E_API_PORT=3261 npx playwright test " +
          "tests/e2e/palette-cross-device-sync.spec.ts " +
          "tests/e2e/onboarding-tour.spec.ts " +
          "tests/e2e/settings-cross-device-sync.spec.ts " +
          "tests/e2e/settings-save-buttons.spec.ts " +
          "tests/e2e/zone-colour-server-sync.spec.ts " +
          "tests/e2e/tooltips.spec.ts " +
          "tests/e2e/adaptive-palette.spec.ts " +
          "2>&1 | tee .local/tmp/palette-e2e.log",
        ],
        "e2e",
        "e2e-palette",
      ),
      ["unit-cpu", "e2e-port"],
      HEAVY_PRIORITY,
    ),
  },
  {
    // Use test:e2e:run (unwrapped inner command) — locking is handled here.
    name: "test:e2e",
    cmd: wrapWithLocks(
      wrapWithTimeout(
        ["pnpm", "run", "test:e2e:run"],
        "e2e",
        "test:e2e",
      ),
      ["unit-cpu", "e2e-port"],
      HEAVY_PRIORITY,
    ),
  },
];

/**
 * Between steps, sweep the e2e ports INCLUDING holders in our own process
 * tree: orphaned webServers from a finished step get reparented under the
 * still-alive workflow supervisor (a subreaper), so the normal own-tree
 * exemption in kill-port-holders would wrongly protect them and the next
 * step fails with "port already used". This is safe here because between
 * steps nothing of ours should legitimately hold these ports.
 */
function sweepE2ePorts() {
  const script = resolve(root, "scripts/kill-port-holders.mjs");
  spawnSync("node", [script, "--e2e", "--include-own-tree"], { stdio: "inherit", cwd: root });
  spawnSync("node", [script, "--e2e", "--include-own-tree"], {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, E2E_WEB_PORT: "3250", E2E_API_PORT: "3261" },
  });
}

const overallStart = Date.now();
const results = [];

for (const { name, cmd } of steps) {
  sweepE2ePorts();
  const start = Date.now();
  console.log(`\n[test-heavy] ▶ step "${name}" starting (total elapsed ${((start - overallStart) / 1000).toFixed(0)}s)`);
  const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", cwd: root });
  const exitCode = res.status ?? 1;
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  results.push({ name, secs, exitCode });
  console.log(`[test-heavy] ■ step "${name}" finished in ${secs}s (exit ${exitCode})`);
}

console.log("\n[test-heavy] step summary:");
let failed = false;
for (const r of results) {
  console.log(`  ${r.secs.padStart(7)}s  exit ${r.exitCode}  ${r.name}`);
  if (r.exitCode !== 0) failed = true;
}
console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
