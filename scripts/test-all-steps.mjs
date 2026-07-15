#!/usr/bin/env node
/**
 * Layer 5 helper — runs the test-all step sequence with per-step wall-clock
 * timing so that, when the aggregate budget (tests/timeout-guard/budgets.json
 * → aggregate.totalBudgetMs, enforced by scripts/run-with-timeout.mjs) is
 * breached, the report can attribute time to the step that consumed it.
 *
 * Invoked by the root "test-all" script as:
 *   node scripts/run-with-timeout.mjs aggregate -- node scripts/test-all-steps.mjs
 */
import { spawnSync } from "node:child_process";

const steps = [
  ["typecheck", "pnpm run typecheck"],
  ["lint", "pnpm run lint"],
  ["test:unit", "pnpm run test:unit"],
  ["check:docs-stale", "pnpm run check:docs-stale"],
  ["check:catalog-coverage", "pnpm run check:catalog-coverage"],
  ["check:e2e-user-ids", "pnpm run check:e2e-user-ids"],
  ["check:e2e-cjs-globals", "pnpm run check:e2e-cjs-globals"],
  ["check:fixture-freshness", "pnpm run check:fixture-freshness"],
  ["check:ports", "pnpm run check:ports"],
];

const overallStart = Date.now();
const timings = [];

for (const [name, cmd] of steps) {
  const start = Date.now();
  console.log(`\n[test-all] ▶ step "${name}" starting (total elapsed ${((start - overallStart) / 1000).toFixed(0)}s)`);
  const res = spawnSync(cmd, { shell: true, stdio: "inherit" });
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  timings.push({ name, secs });
  console.log(`[test-all] ■ step "${name}" finished in ${secs}s (exit ${res.status})`);
  if (res.status !== 0) {
    printSummary();
    process.exit(res.status ?? 1);
  }
}

printSummary();

function printSummary() {
  console.log("\n[test-all] step timing summary:");
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
}
