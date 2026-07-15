#!/usr/bin/env node
/**
 * Layer 4/5 total-run timeout wrapper.
 *
 * Usage:
 *   node scripts/run-with-timeout.mjs <budgetKey|milliseconds> [--label NAME] -- <command...>
 *
 * <budgetKey> resolves `runBudgetMs` (or `totalBudgetMs` for "aggregate")
 * from tests/timeout-guard/budgets.json. A raw millisecond number is also
 * accepted for ad-hoc use.
 *
 * The wrapped command runs in its own process group. On budget breach the
 * whole group receives SIGTERM, then SIGKILL after 10 s, and a diagnostic
 * report is emitted (console + .local/test-timeout-reports/).
 *
 * For the aggregate (test-all) layer, per-step elapsed times are echoed by
 * scripts/test-all-steps.mjs so a breach report can attribute time to steps.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { emitBreachReport } from "../tests/timeout-guard/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(readFileSync(resolve(here, "../tests/timeout-guard/budgets.json"), "utf8"));

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1 || sep === 0) {
  console.error("Usage: run-with-timeout.mjs <budgetKey|ms> [--label NAME] -- <command...>");
  process.exit(2);
}
const head = argv.slice(0, sep);
const command = argv.slice(sep + 1);
const budgetKeyOrMs = head[0];
let label = command.join(" ");
const labelIdx = head.indexOf("--label");
if (labelIdx !== -1 && head[labelIdx + 1]) label = head[labelIdx + 1];

let budgetMs;
if (/^\d+$/.test(budgetKeyOrMs)) {
  budgetMs = Number(budgetKeyOrMs);
} else {
  const entry = budgets[budgetKeyOrMs];
  if (!entry) {
    console.error(`Unknown budget key "${budgetKeyOrMs}". Known: ${Object.keys(budgets).filter((k) => !k.startsWith("$")).join(", ")}`);
    process.exit(2);
  }
  budgetMs = entry.runBudgetMs ?? entry.totalBudgetMs;
  if (!budgetMs) {
    console.error(`Budget key "${budgetKeyOrMs}" has no runBudgetMs/totalBudgetMs.`);
    process.exit(2);
  }
}

const layer = budgetKeyOrMs === "aggregate" ? "aggregate" : "run";
const start = Date.now();
console.log(`[timeout-guard] ${layer} budget ${(budgetMs / 1000).toFixed(0)}s for: ${label}`);

const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  detached: true,
  env: { ...process.env, TIMEOUT_GUARD_RUN_START: String(start) },
});

let breached = false;
const timer = setTimeout(() => {
  breached = true;
  emitBreachReport({
    layer,
    name: label,
    elapsedMs: Date.now() - start,
    budgetMs,
    suggestions:
      layer === "aggregate"
        ? [
            "Check the [test-all] step timing lines above to see which step consumed the budget.",
            "Run the offending step alone with its own Layer-4 wrapper to get a per-file breakdown.",
          ]
        : [
            "Re-run this suite alone with `vitest run --reporter=verbose` (or `playwright test --reporter=list`) to find the hanging file.",
            "A run-level hang with no file-level breach usually means a stuck globalSetup, webServer boot, or a worker process that never exits.",
          ],
  });
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch { /* already gone */ }
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch { /* already gone */ }
  }, 10_000).unref();
}, budgetMs);
timer.unref();

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (breached) {
    console.error(`[timeout-guard] killed after budget breach (ran ${elapsed}s)`);
    process.exit(124);
  }
  console.log(`[timeout-guard] ${label} finished in ${elapsed}s (budget ${(budgetMs / 1000).toFixed(0)}s)`);
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
