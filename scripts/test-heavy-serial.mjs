#!/usr/bin/env node
/**
 * Serialized runner for the three heavy test suites (unit, palette e2e,
 * full e2e). Running them in parallel overloads the machine and causes
 * timeout-guard budget breaches with no real test failures, so this script
 * runs them one after another with per-step timing.
 *
 * All steps always run (no fail-fast) so a single validation pass reports
 * every failing suite; the exit code is non-zero if any step failed.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockScript = resolve(root, "scripts/validation-lock.mjs");
const timeoutScript = resolve(root, "scripts/run-with-timeout.mjs");
mkdirSync(resolve(root, ".local/tmp"), { recursive: true });

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

const steps = [
  {
    name: "test:unit",
    cmd: wrapWithLocks(
      wrapWithTimeout(
        ["pnpm", "run", "test:unit"],
        "apiServerUnit",
        "test:unit",
      ),
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
