#!/usr/bin/env node
/**
 * run-validation-ad-hoc.mjs — helper for ad-hoc / non-task developer runs.
 *
 * Task-driven validation runs always set TASK_PLAN_FILE so that run-tier.mjs
 * can enforce the plan's tier ceiling automatically.  When TASK_PLAN_FILE is
 * absent and --allow-no-plan is NOT passed, run-tier.mjs now exits 1 with a
 * TIER-LOCK VIOLATION to prevent agents from bypassing tier enforcement by
 * simply omitting the env var.
 *
 * For legitimate non-task callers — ad-hoc developer spot-checks, one-off CI
 * audit runs, manual debugging — this script provides the correct invocation
 * pattern.  It forwards all arguments to run-tier.mjs and automatically
 * appends --allow-no-plan so the missing TASK_PLAN_FILE is treated as graceful
 * degradation (warn + continue) rather than a hard error.
 *
 * Usage:
 *   node scripts/run-validation-ad-hoc.mjs fast
 *   node scripts/run-validation-ad-hoc.mjs standard
 *   node scripts/run-validation-ad-hoc.mjs full
 *   node scripts/run-validation-ad-hoc.mjs standard --skip test:unit
 *
 * Equivalent manual invocations (without this wrapper):
 *   node scripts/run-tier.mjs fast     --allow-no-plan
 *   node scripts/run-tier.mjs standard --allow-no-plan
 *   node scripts/run-tier.mjs full     --allow-no-plan
 *
 * WARNING: Do NOT use this script (or --allow-no-plan) for task-driven runs.
 * Task agents must always set TASK_PLAN_FILE so the tier ceiling in the plan
 * is enforced mechanically.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runTierScript = resolve(root, "scripts/run-tier.mjs");

const userArgs = process.argv.slice(2);

// Append --allow-no-plan if the caller did not already include it.
const extraArgs = userArgs.includes("--allow-no-plan") ? [] : ["--allow-no-plan"];

const res = spawnSync(
  process.execPath,
  [runTierScript, ...userArgs, ...extraArgs],
  { stdio: "inherit", cwd: root },
);

process.exit(res.status ?? 1);
