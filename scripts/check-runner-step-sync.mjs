#!/usr/bin/env node
/**
 * check-runner-step-sync.mjs — Static drift guard for the validation runners.
 *
 * Two checks, both parsing the same files:
 *
 * 1. Step-list sync — the ordered step lists in scripts/run-tier.mjs
 *    (ALL_STEPS) and scripts/test-all-steps.mjs (steps) must be identical.
 *    run-tier's "full" tier documents itself as identical to test-all-steps;
 *    silent divergence means a step runs in one CI path but not the other.
 *
 * 2. CI coverage meta-check — every "check:*" script defined in the root
 *    package.json must appear in the CI step sequence (the shared step list),
 *    unless it is explicitly allowlisted below with a reason. This catches
 *    check scripts that exist but silently never run in CI.
 *
 * Usage:
 *   node scripts/check-runner-step-sync.mjs
 *
 * Exported functions are unit-tested in scripts/src/check-runner-step-sync.test.mjs.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CI coverage allowlist
//
// check:* scripts that intentionally do NOT appear in the runner step lists.
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
// Parsers
// ---------------------------------------------------------------------------

/**
 * Extracts the ordered step names from run-tier.mjs source by parsing the
 * ALL_STEPS array literal (entries of shape `{ name: "...", resource: ... }`).
 */
export function extractRunTierSteps(source) {
  const start = source.indexOf("const ALL_STEPS = [");
  if (start === -1) {
    throw new Error("run-tier.mjs: could not find `const ALL_STEPS = [` — parser needs updating");
  }
  const end = source.indexOf("];", start);
  if (end === -1) {
    throw new Error("run-tier.mjs: could not find end of ALL_STEPS array");
  }
  const block = source.slice(start, end);
  const names = [...block.matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error("run-tier.mjs: parsed zero step names from ALL_STEPS — parser needs updating");
  }
  return names;
}

/**
 * Extracts the ordered step names from test-all-steps.mjs source by parsing
 * the steps array literal (entries of shape `["name", cmdOrFn]`).
 */
export function extractTestAllSteps(source) {
  const start = source.indexOf("const steps = [");
  if (start === -1) {
    throw new Error("test-all-steps.mjs: could not find `const steps = [` — parser needs updating");
  }
  const end = source.indexOf("];", start);
  if (end === -1) {
    throw new Error("test-all-steps.mjs: could not find end of steps array");
  }
  const block = source.slice(start, end);
  const names = [...block.matchAll(/\[\s*"([^"]+)"\s*,/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error("test-all-steps.mjs: parsed zero step names from steps — parser needs updating");
  }
  return names;
}

/**
 * Compares two ordered step-name lists. Returns an array of human-readable
 * divergence descriptions (empty when identical).
 */
export function compareStepLists(runTierSteps, testAllSteps) {
  const problems = [];
  const max = Math.max(runTierSteps.length, testAllSteps.length);
  for (let i = 0; i < max; i++) {
    const a = runTierSteps[i];
    const b = testAllSteps[i];
    if (a !== b) {
      problems.push(
        `position ${i}: run-tier.mjs has ${a ? JSON.stringify(a) : "(missing)"} but test-all-steps.mjs has ${b ? JSON.stringify(b) : "(missing)"}`,
      );
    }
  }
  return problems;
}

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
  const runTierSource = readFileSync(resolve(root, "scripts/run-tier.mjs"), "utf8");
  const testAllSource = readFileSync(resolve(root, "scripts/test-all-steps.mjs"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

  const runTierSteps = extractRunTierSteps(runTierSource);
  const testAllSteps = extractTestAllSteps(testAllSource);

  let failed = false;

  const divergences = compareStepLists(runTierSteps, testAllSteps);
  if (divergences.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — step lists diverge between run-tier.mjs and test-all-steps.mjs:");
    for (const d of divergences) console.error(`  ${d}`);
    console.error(
      "  Fix: keep ALL_STEPS in scripts/run-tier.mjs and steps in scripts/test-all-steps.mjs identical\n" +
      "  (same names, same order). Add/remove/move the step in BOTH files.",
    );
  }

  const uncovered = findUncoveredChecks(pkg, runTierSteps);
  if (uncovered.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check:* script(s) defined in package.json but never run in CI:");
    for (const n of uncovered) console.error(`  ${n}`);
    console.error(
      "  Fix: add the script as a step in BOTH scripts/run-tier.mjs (ALL_STEPS) and\n" +
      "  scripts/test-all-steps.mjs, OR add it to CI_COVERAGE_ALLOWLIST in\n" +
      "  scripts/check-runner-step-sync.mjs with a reason explaining where its coverage comes from.",
    );
  }

  const stale = findStaleAllowlistEntries(pkg, runTierSteps);
  if (stale.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — stale CI_COVERAGE_ALLOWLIST entr(ies):");
    for (const n of stale) console.error(`  ${n} (script removed from package.json, or now runs in the CI sequence)`);
    console.error("  Fix: remove the entry from CI_COVERAGE_ALLOWLIST in scripts/check-runner-step-sync.mjs.");
  }

  if (failed) process.exit(1);

  console.log(
    `[check-runner-step-sync] OK — ${runTierSteps.length} steps in sync; ` +
    `all check:* scripts covered (${Object.keys(CI_COVERAGE_ALLOWLIST).length} allowlisted).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
