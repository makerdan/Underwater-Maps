#!/usr/bin/env node
/**
 * check-runner-step-sync.mjs — CI coverage meta-check for the validation runners.
 *
 * The step lists for scripts/run-tier.mjs and scripts/test-all-steps.mjs are
 * now a single shared module (scripts/validation-steps.mjs), so step-list
 * drift between the runners is structurally impossible and no longer checked.
 *
 * What remains is the CI coverage meta-check: every "check:*" script defined
 * in the root package.json must appear in the shared CI step sequence, unless
 * it is explicitly allowlisted below with a reason. This catches check
 * scripts that exist but silently never run in CI, and allowlist entries that
 * have gone stale.
 *
 * Usage:
 *   node scripts/check-runner-step-sync.mjs
 *
 * Exported functions are unit-tested in scripts/src/check-runner-step-sync.test.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getValidationSteps } from "./validation-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CI coverage allowlist
//
// check:* scripts that intentionally do NOT appear in the shared step list.
// Every entry MUST carry a reason explaining where its coverage comes from.
// ---------------------------------------------------------------------------

export const CI_COVERAGE_ALLOWLIST = {
  "check:codegen":
    "Delegates to the api-spec package's own check; codegen freshness is enforced in CI by the typecheck step's codegen pre-pass (codegen-freshness.mjs).",
  "check:codegen-stale":
    "Runs a full codegen regeneration (slow); the typecheck step's freshness-aware pre-pass regenerates when stale, and check:drift covers this locally.",
  "check:routes-documented":
    "A vitest test file inside the api-server unit suite; already runs in CI as part of the test:unit step.",
  "check:mock-drift":
    "Vitest sentinel test files inside the bathyscan and api-server unit suites; already run in CI as part of the test:unit step.",
  "check:drift":
    "Umbrella convenience runner that re-invokes individual drift checks already present in the step sequence; running it in CI would duplicate work.",
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Returns the names of check:* scripts in the given package.json object that
 * appear neither in the CI step sequence nor in the allowlist.
 */
export function findUncoveredChecks(pkg, ciSteps, allowlist = CI_COVERAGE_ALLOWLIST) {
  const checkNames = Object.keys(pkg.scripts ?? {}).filter((n) => n.startsWith("check:"));
  const ciSet = new Set(ciSteps);
  return checkNames.filter((n) => !ciSet.has(n) && !(n in allowlist));
}

/**
 * Returns allowlist entries that are stale: either the script no longer
 * exists in package.json, or it now DOES run in the CI sequence (so the
 * allowlist entry is redundant and should be removed).
 */
export function findStaleAllowlistEntries(pkg, ciSteps, allowlist = CI_COVERAGE_ALLOWLIST) {
  const scriptNames = new Set(Object.keys(pkg.scripts ?? {}));
  const ciSet = new Set(ciSteps);
  return Object.keys(allowlist).filter((n) => !scriptNames.has(n) || ciSet.has(n));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const ciSteps = getValidationSteps("check-runner-step-sync").map((s) => s.name);

  let failed = false;

  const uncovered = findUncoveredChecks(pkg, ciSteps);
  if (uncovered.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check:* script(s) defined in package.json but never run in CI:");
    for (const n of uncovered) console.error(`  ${n}`);
    console.error(
      "  Fix: add the script as a step in scripts/validation-steps.mjs (the shared\n" +
      "  step list used by run-tier.mjs and test-all-steps.mjs), OR add it to\n" +
      "  CI_COVERAGE_ALLOWLIST in scripts/check-runner-step-sync.mjs with a reason\n" +
      "  explaining where its coverage comes from.",
    );
  }

  const stale = findStaleAllowlistEntries(pkg, ciSteps);
  if (stale.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — stale CI_COVERAGE_ALLOWLIST entr(ies):");
    for (const n of stale) console.error(`  ${n} (script removed from package.json, or now runs in the CI sequence)`);
    console.error("  Fix: remove the entry from CI_COVERAGE_ALLOWLIST in scripts/check-runner-step-sync.mjs.");
  }

  if (failed) process.exit(1);

  console.log(
    `[check-runner-step-sync] OK — ${ciSteps.length} shared steps; ` +
    `all check:* scripts covered (${Object.keys(CI_COVERAGE_ALLOWLIST).length} allowlisted).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
