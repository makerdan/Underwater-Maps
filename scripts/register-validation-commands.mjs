#!/usr/bin/env node
/**
 * register-validation-commands.mjs
 *
 * Canonical manifest of the tiered validation commands plus standalone
 * scheduled checks.
 *
 * When run as a shell script it prints the manifest so post-merge.sh
 * can echo it to the log. The commands listed here are what must be
 * registered on the Replit platform via setValidationCommand().
 *
 * Post-merge re-registration: after a fresh clone/merge, an agent session
 * should call setValidationCommand() for each entry below using the
 * code_execution sandbox.  The commands are idempotent — re-registering
 * an already-registered command is safe.
 *
 * Per-step named resource locking is now handled INSIDE run-tier.mjs, so
 * the outer validation-lock.mjs wrapper has been removed. Only steps that
 * actually conflict (codegen race, CPU saturation) acquire a lock, and they
 * do so for exactly the duration of that step. Fast steps with priority 1
 * jump the queue ahead of heavy steps with priority 3.
 *
 * Budget keys live in tests/timeout-guard/budgets.json:
 *   tierFast.runBudgetMs         = 300 000 ms   (5 min)
 *   tierStandard.runBudgetMs     = 1 200 000 ms (20 min)
 *   tierStandardPlus.runBudgetMs = 2 100 000 ms (35 min)
 *   aggregate.totalBudgetMs      = 3 000 000 ms (50 min)
 *
 * Scheduled / DB-backed commands (not part of the tiered suite):
 *   audit-marker-bbox — requires DATABASE_URL pointing at a live DB.
 *     Run on a regular cadence (e.g. nightly/weekly) to catch bbox drift
 *     before it accumulates. The underlying script exits 1 when any marker
 *     falls outside its dataset's bbox or references a deleted dataset.
 */

export const VALIDATION_COMMANDS = [
  {
    name: "test-fast",
    command:
      "node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast",
    budgetKey: "tierFast",
    description:
      "typecheck + lint only (~5 min). Pick for UI/copy/style/new-component-only changes.",
  },
  {
    name: "test-standard",
    command:
      "node scripts/run-with-timeout.mjs tierStandard -- node scripts/run-tier.mjs standard",
    budgetKey: "tierStandard",
    description:
      "typecheck + lint + unit tests + docs/catalog checks (~20 min). " +
      "Pick for bug fixes, features touching existing endpoints, new settings keys.",
  },
  {
    name: "test-standard-plus",
    command:
      "node scripts/run-with-timeout.mjs tierStandardPlus -- node scripts/run-tier.mjs full",
    budgetKey: "tierStandardPlus",
    description:
      "all static + unit steps, no Playwright (~35 min). " +
      "Pick for new API endpoints with no existing e2e coverage, or refactors spanning " +
      "multiple packages with no auth/schema/e2e changes.",
  },
  {
    name: "test-heavy",
    command:
      "node scripts/run-with-timeout.mjs aggregate -- node scripts/test-heavy-serial.mjs",
    budgetKey: "aggregate",
    description:
      "all steps including e2e (~45 min). Pick for new API routes, schema migrations, " +
      "auth/security changes, or multi-package refactors.",
  },
  // ---------------------------------------------------------------------------
  // Scheduled / DB-backed commands — not part of the tiered test suite.
  // These require a live DATABASE_URL and are intended to run on a regular
  // cadence (e.g. nightly or weekly) rather than on every code change.
  // ---------------------------------------------------------------------------
  {
    name: "audit-marker-bbox",
    // NOTE: the command does NOT set AUDIT_MARKER_BBOX_ENABLED=1 here.
    // Without that env var the script exits 0 immediately (graceful no-op),
    // so this command is safe to run in any environment without a live DB.
    // The scheduled trigger (post-merge.sh) sets AUDIT_MARKER_BBOX_ENABLED=1
    // so the audit actually runs after every merge against the dev DB.
    // To run manually: AUDIT_MARKER_BBOX_ENABLED=1 pnpm --filter @workspace/db audit:marker-bbox -- --ci
    command:
      "pnpm --filter @workspace/db audit:marker-bbox -- --ci",
    budgetKey: null,
    description:
      "DB-backed bbox drift audit (~seconds, needs DATABASE_URL + AUDIT_MARKER_BBOX_ENABLED=1). " +
      "Exits 1 if any marker falls outside its dataset's coverage bbox or references a " +
      "deleted dataset. Runs automatically after every merge via post-merge.sh. " +
      "Manual: AUDIT_MARKER_BBOX_ENABLED=1 pnpm --filter @workspace/db audit:marker-bbox -- --ci",
  },
];

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log("[register-validation-commands] Validation command manifest:");
  for (const { name, command, budgetKey, description } of VALIDATION_COMMANDS) {
    console.log(`\n  ${name}`);
    console.log(`    command:    ${command}`);
    if (budgetKey) console.log(`    budgetKey:  ${budgetKey}`);
    console.log(`    description: ${description}`);
  }
  console.log(
    "\n[register-validation-commands] To register on the Replit platform, " +
    "call setValidationCommand({ name, command }) for each entry above " +
    "from the agent code_execution sandbox.",
  );
}
