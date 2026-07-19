#!/usr/bin/env node
/**
 * register-validation-commands.mjs
 *
 * Canonical manifest of the three tiered validation commands.
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
 *   tierFast.runBudgetMs     = 300 000 ms  (5 min)
 *   tierStandard.runBudgetMs = 1 200 000 ms (20 min)
 *   aggregate.totalBudgetMs  = 2 700 000 ms (45 min)
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
    name: "test-heavy",
    command:
      "node scripts/run-with-timeout.mjs aggregate -- node scripts/test-heavy-serial.mjs",
    budgetKey: "aggregate",
    description:
      "all steps including e2e (~45 min). Pick for new API routes, schema migrations, " +
      "auth/security changes, or multi-package refactors.",
  },
];

if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log("[register-validation-commands] Tiered validation command manifest:");
  for (const { name, command, budgetKey, description } of VALIDATION_COMMANDS) {
    console.log(`\n  ${name}`);
    console.log(`    command:    ${command}`);
    console.log(`    budgetKey:  ${budgetKey}`);
    console.log(`    description: ${description}`);
  }
  console.log(
    "\n[register-validation-commands] To register on the Replit platform, " +
    "call setValidationCommand({ name, command }) for each entry above " +
    "from the agent code_execution sandbox.",
  );
}
