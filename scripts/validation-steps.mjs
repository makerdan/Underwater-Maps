/**
 * Shared single source of truth for validation step definitions, used by
 * run-tier.mjs and test-all-steps.mjs (same extraction pattern as
 * codegen-freshness.mjs). Neither runner keeps its own step list — add or
 * change steps HERE only, so the two runners cannot drift.
 *
 * Each step entry:
 *   name      — display name and run-tier --step key
 *   resource  — named lock resource for run-tier (null = run without lock)
 *   cmd       — shell command string, or a function returning exit code
 */
import { spawnSync } from "node:child_process";
import { isCodegenFresh } from "./codegen-freshness.mjs";

/**
 * Runs the typecheck step with a freshness-aware codegen pre-pass.
 *
 * If the generated api.ts is already newer than all codegen inputs
 * (openapi.yaml and orval.config.ts) we skip the codegen invocation — this is
 * the common case when the `typecheck` workflow already ran codegen moments
 * ago. When stale we fall through to the normal codegen step before tsc.
 *
 * Either way, typecheck:libs and the per-artifact typecheck passes always run.
 *
 * @param {string} logPrefix e.g. "run-tier" or "test-all"
 * @returns {number} exit code
 */
export function runTypecheckStep(logPrefix) {
  if (isCodegenFresh()) {
    console.log(`[${logPrefix}] codegen is fresh — skipping`);
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

/**
 * Returns the canonical ordered step list. The typecheck step's function cmd
 * is bound to the caller's log prefix.
 *
 * @param {string} logPrefix e.g. "run-tier" or "test-all"
 * @returns {Array<{name: string, resource: string|null, cmd: string|Function, testAll?: boolean}>}
 */
export function getValidationSteps(logPrefix) {
  return [
    // codegen resource: prevents concurrent api.ts regeneration
    { name: "typecheck", resource: "codegen", cmd: () => runTypecheckStep(logPrefix) },
    // no resource: lint is read-only and does not conflict with anything
    { name: "lint", resource: null, cmd: "pnpm run lint" },
    // no resource: grep-based drift check, sub-second
    { name: "check:lock-skill-sync", resource: null, cmd: "pnpm run check:lock-skill-sync" },
    // no resource: grep-based root-relative /api/ fetch guard, sub-second
    { name: "check:root-relative-api", resource: null, cmd: "pnpm run check:root-relative-api" },
    // no resource: grep-based exhaustive-deps suppression rationale gate, sub-second
    { name: "check:deps-suppression", resource: null, cmd: "pnpm run check:deps-suppression" },
    // no resource: CI coverage meta-check for check:* scripts, sub-second
    { name: "check:runner-step-sync", resource: null, cmd: "pnpm run check:runner-step-sync" },
    // unit-cpu resource: prevents CPU saturation / budget breach
    { name: "test:unit", resource: "unit-cpu", cmd: "pnpm run test:unit" },
    // all check:* steps are lightweight; no resource needed
    { name: "check:docs-stale", resource: null, cmd: "pnpm run check:docs-stale" },
    { name: "check:catalog-coverage", resource: null, cmd: "pnpm run check:catalog-coverage" },
    // no resource: pure schema-vs-snapshot diff, no DB connection, sub-second
    { name: "check:schema-stale", resource: null, cmd: "pnpm run check:schema-stale" },
    { name: "check:e2e-user-ids", resource: null, cmd: "pnpm run check:e2e-user-ids" },
    { name: "check:e2e-cjs-globals", resource: null, cmd: "pnpm run check:e2e-cjs-globals" },
    // no resource: grep-based panel-collapse localStorage guard, sub-second
    { name: "check:e2e-panel-collapse", resource: null, cmd: "pnpm run check:e2e-panel-collapse" },
    { name: "check:fixture-freshness", resource: null, cmd: "pnpm run check:fixture-freshness" },
    { name: "check:ports", resource: null, cmd: "pnpm run check:ports" },
    // no resource: pure static analysis of entry-point port wiring (Vite config,
    // API bootstrap, Playwright URLs)
    { name: "check:port-drift", resource: null, cmd: "pnpm run check:port-drift" },
    { name: "check:audit", resource: null, cmd: "pnpm run check:audit" },
    // no resource: pure grep scan, sub-second
    { name: "check:bare-pino-http-mock", resource: null, cmd: "pnpm run check:bare-pino-http-mock" },
  ];
}
