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
import { statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

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
 *
 * If the generated api.ts is already newer than all codegen inputs (openapi.yaml
 * and orval.config.ts) we skip the codegen invocation — this is the common case
 * when the `typecheck` workflow already ran codegen moments ago.  When stale we
 * fall through to the normal codegen step before running tsc.
 *
 * Either way, typecheck:libs and the per-artifact typecheck passes always run.
 */
function runTypecheckStep() {
  if (isCodegenFresh()) {
    console.log("[test-all] codegen is fresh — skipping");
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

const steps = [
  ["typecheck", runTypecheckStep],
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

for (const [name, cmdOrFn] of steps) {
  const start = Date.now();
  console.log(`\n[test-all] ▶ step "${name}" starting (total elapsed ${((start - overallStart) / 1000).toFixed(0)}s)`);
  let exitCode;
  if (typeof cmdOrFn === "function") {
    exitCode = cmdOrFn();
  } else {
    const res = spawnSync(cmdOrFn, { shell: true, stdio: "inherit" });
    exitCode = res.status ?? 1;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  timings.push({ name, secs });
  console.log(`[test-all] ■ step "${name}" finished in ${secs}s (exit ${exitCode})`);
  if (exitCode !== 0) {
    printSummary();
    process.exit(exitCode);
  }
}

printSummary();

function printSummary() {
  console.log("\n[test-all] step timing summary:");
  for (const t of timings) console.log(`  ${t.secs.padStart(7)}s  ${t.name}`);
  console.log(`  total: ${((Date.now() - overallStart) / 1000).toFixed(1)}s`);
}
