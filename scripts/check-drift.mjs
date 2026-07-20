#!/usr/bin/env node
/**
 * check-drift.mjs — Umbrella drift-detection runner.
 *
 * Runs all six drift classes and prints a per-class pass/fail summary with
 * remediation hints. The tiered validation commands (test-fast, test-standard,
 * test-heavy) registered via scripts/register-validation-commands.mjs run
 * individual drift classes as part of their check suites; this runner is the
 * local equivalent: `pnpm run check:drift`.
 *
 * Drift classes:
 *   1. api-codegen   — OpenAPI spec vs. generated client/Zod code
 *   2. db-schema     — Drizzle TS schema vs. committed migration snapshots
 *   3. test-fixtures — committed binary fixtures vs. generate.mjs (needs Python 3.11)
 *   4. docs          — generated API docs vs. routes
 *   5. mock-contract — Clerk bypass + API client mocks vs. real module surfaces
 *   6. config-ports  — hardcoded/colliding ports vs. PORT env contract
 */
import { spawnSync } from "node:child_process";

const CLASSES = [
  {
    name: "api-codegen",
    cmd: ["pnpm", "run", "check:codegen-stale"],
    hint: "Run `pnpm --filter @workspace/api-spec run codegen:generate` and commit the regenerated client.",
  },
  {
    name: "db-schema",
    cmd: ["node", "scripts/check-schema-drift.mjs"],
    hint: "Run `cd lib/db && pnpm exec drizzle-kit generate --config ./drizzle-check.config.ts` and commit the new migration + snapshot.",
  },
  {
    name: "test-fixtures",
    cmd: ["bash", "artifacts/api-server/src/__tests__/fixtures/check-fixture-freshness.sh"],
    hint: "Run `pnpm --filter @workspace/api-server run fixtures:regen` and commit the fixtures (requires Python 3.11).",
  },
  {
    name: "docs",
    cmd: ["sh", "-c", "pnpm run check:docs-stale && pnpm run check:routes-documented"],
    hint: "Run `pnpm run docs` and commit the regenerated API docs; document any new routes.",
  },
  {
    name: "mock-contract",
    cmd: ["pnpm", "run", "check:mock-drift"],
    hint: "Update apiClientMock.ts patterns or clerkCompat.tsx bypass stubs to match the real module surface (see the failing test output).",
  },
  {
    name: "config-ports",
    cmd: ["node", "scripts/check-port-drift.mjs"],
    hint: "Derive ports from the PORT env var and keep statically declared ports unique (see script output).",
  },
];

const results = [];
for (const cls of CLASSES) {
  console.log(`\n━━━ drift class: ${cls.name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  const res = spawnSync(cls.cmd[0], cls.cmd.slice(1), { stdio: "inherit", shell: false });
  results.push({ name: cls.name, ok: res.status === 0, hint: cls.hint });
}

console.log("\n══════════════════════ DRIFT SUMMARY ══════════════════════");
let failed = 0;
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  if (!r.ok) {
    failed++;
    console.log(`        ↳ ${r.hint}`);
  }
}
console.log("════════════════════════════════════════════════════════════");

if (failed > 0) {
  console.error(`\n${failed} of ${results.length} drift class(es) FAILED.`);
  process.exit(1);
}
console.log(`\nAll ${results.length} drift classes passed.`);
