#!/usr/bin/env node
/**
 * run-tier.mjs — tiered validation runner.
 *
 * Usage:
 *   node scripts/run-tier.mjs fast       # typecheck + lint (~5 min)
 *   node scripts/run-tier.mjs standard   # typecheck + lint + unit + doc/catalog checks (~20 min)
 *   node scripts/run-tier.mjs full       # all 10 steps, identical to test-all-steps.mjs (~45 min)
 *
 * Wrapped by the validation commands as:
 *   node scripts/validation-lock.mjs -- node scripts/run-tier.mjs <tier>
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

const VALID_TIERS = ["fast", "standard", "full"];
const tier = process.argv[2];

if (!tier || !VALID_TIERS.includes(tier)) {
  console.error(`Usage: run-tier.mjs <fast|standard|full>\nGot: ${JSON.stringify(tier)}`);
  process.exit(2);
}

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

const ALL_STEPS = [
  ["typecheck", runTypecheckStep],
  ["lint", "pnpm run lint"],
  ["test:unit", "pnpm run test:unit"],
  ["check:docs-stale", "pnpm run check:docs-stale"],
  ["check:catalog-coverage", "pnpm run check:catalog-coverage"],
  ["check:e2e-user-ids", "pnpm run check:e2e-user-ids"],
  ["check:e2e-cjs-globals", "pnpm run check:e2e-cjs-globals"],
  ["check:fixture-freshness", "pnpm run check:fixture-freshness"],
  ["check:ports", "pnpm run check:ports"],
  ["check:audit", "pnpm run check:audit"],
];

const TIER_STEPS = {
  fast:     ALL_STEPS.slice(0, 2),
  standard: ALL_STEPS.slice(0, 5),
  full:     ALL_STEPS,
};

const steps = TIER_STEPS[tier];

console.log(`\n[run-tier] tier="${tier}" — running ${steps.length} step(s): ${steps.map(([n]) => n).join(", ")}`);

const overallStart = Date.now();
const timings = [];

for (const [name, cmdOrFn] of steps) {
  const start = Date.now();
  console.log(`\n[run-tier] ▶ step "${name}" starting (total elapsed ${((start - overallStart) / 1000).toFixed(0)}s)`);
  let exitCode;
  if (typeof cmdOrFn === "function") {
    exitCode = cmdOrFn();
  } else {
    const res = spawnSync(cmdOrFn, { shell: true, stdio: "inherit" });
    exitCode = res.status ?? 1;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  timings.push({ name, secs });
  console.log(`[run-tier] ■ step "${name}" finished in ${secs}s (exit ${exitCode})`);
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
