#!/usr/bin/env node
/**
 * check-runner-step-sync.mjs — CI coverage meta-check for the validation runners.
 *
 * The step lists for scripts/run-tier.mjs and scripts/test-all-steps.mjs are
 * now a single shared module (scripts/validation-steps.mjs), so step-list
 * drift between the runners is structurally impossible and no longer checked.
 *
 * What remains is the CI coverage meta-check:
 *   1. Every "check:*" script defined in the root package.json must appear in
 *      the shared CI step sequence, unless it is explicitly allowlisted below
 *      with a reason. This catches check scripts that exist but silently
 *      never run in CI, and allowlist entries that have gone stale.
 *   2. Every check-*.{mjs,sh} FILE in scripts/ must be referenced somewhere —
 *      a package.json script, a workflow (.replit), or another (non-check)
 *      script such as post-merge.sh — unless allowlisted with a reason. This
 *      catches check files that exist only on disk and can go permanently
 *      unused with no warning.
 *
 * Usage:
 *   node scripts/check-runner-step-sync.mjs
 *
 * Exported functions are unit-tested in scripts/src/check-runner-step-sync.test.mjs.
 */
import { readFileSync, readdirSync } from "node:fs";
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
// Orphaned check-file allowlist
//
// check-*.{mjs,sh} files in scripts/ that are intentionally NOT referenced by
// any package.json script, workflow, or other script (e.g. manual-only
// tooling). Keys are bare filenames; every entry MUST carry a reason.
// ---------------------------------------------------------------------------

export const ORPHAN_FILE_ALLOWLIST = {
  // (empty — every check file on disk is currently wired up somewhere)
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * Returns check-* filenames that are referenced nowhere in the given
 * reference text (concatenated contents of package.json, .replit workflows,
 * and non-check scripts) and are not allowlisted.
 *
 * @param {string[]} checkFiles bare filenames, e.g. "check-foo.sh"
 * @param {string} referenceText concatenated searchable sources
 * @param {Record<string,string>} allowlist filename -> reason
 */
export function findOrphanCheckFiles(checkFiles, referenceText, allowlist = ORPHAN_FILE_ALLOWLIST) {
  return checkFiles.filter((f) => !referenceText.includes(f) && !(f in allowlist));
}

/**
 * Returns ORPHAN_FILE_ALLOWLIST entries that are stale: the file no longer
 * exists on disk, or it now IS referenced somewhere.
 */
export function findStaleOrphanAllowlistEntries(checkFiles, referenceText, allowlist = ORPHAN_FILE_ALLOWLIST) {
  const onDisk = new Set(checkFiles);
  return Object.keys(allowlist).filter((f) => !onDisk.has(f) || referenceText.includes(f));
}

/**
 * Enumerates check-*.{mjs,sh} files in scripts/ (bare filenames).
 */
export function listCheckFiles(scriptsDir) {
  return readdirSync(scriptsDir)
    .filter((f) => /^check-.*\.(mjs|sh)$/.test(f))
    .sort();
}

/**
 * Builds the searchable reference text: root package.json, the .replit
 * workflow config, and every non-check *.mjs / *.sh script in scripts/.
 * Check files themselves are excluded as sources so a check file cannot
 * "cover" itself (or another orphan) merely by mentioning it in a comment.
 */
export function buildReferenceText(rootDir, scriptsDir) {
  const parts = [readFileSync(resolve(rootDir, "package.json"), "utf8")];
  try {
    parts.push(readFileSync(resolve(rootDir, ".replit"), "utf8"));
  } catch {
    // .replit may not exist in stripped-down environments; skip
  }
  for (const f of readdirSync(scriptsDir)) {
    if (/^check-/.test(f)) continue;
    if (!/\.(mjs|sh)$/.test(f)) continue;
    parts.push(readFileSync(resolve(scriptsDir, f), "utf8"));
  }
  return parts.join("\n");
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

  // Orphaned check FILES: check-*.{mjs,sh} on disk referenced nowhere.
  const checkFiles = listCheckFiles(__dirname);
  const referenceText = buildReferenceText(root, __dirname);

  const orphans = findOrphanCheckFiles(checkFiles, referenceText);
  if (orphans.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — check-* file(s) in scripts/ referenced nowhere (no package.json script, no workflow, no other script):");
    for (const f of orphans) console.error(`  scripts/${f}`);
    console.error(
      "  Fix: wire the file up (package.json script + scripts/validation-steps.mjs\n" +
      "  step, workflow, or invoking script), delete it, OR add it to\n" +
      "  ORPHAN_FILE_ALLOWLIST in scripts/check-runner-step-sync.mjs with a reason.",
    );
  }

  const staleOrphans = findStaleOrphanAllowlistEntries(checkFiles, referenceText);
  if (staleOrphans.length > 0) {
    failed = true;
    console.error("[check-runner-step-sync] FAIL — stale ORPHAN_FILE_ALLOWLIST entr(ies):");
    for (const f of staleOrphans) console.error(`  ${f} (file removed from scripts/, or now referenced somewhere)`);
    console.error("  Fix: remove the entry from ORPHAN_FILE_ALLOWLIST in scripts/check-runner-step-sync.mjs.");
  }

  if (failed) process.exit(1);

  console.log(
    `[check-runner-step-sync] OK — ${ciSteps.length} shared steps; ` +
    `all check:* scripts covered (${Object.keys(CI_COVERAGE_ALLOWLIST).length} allowlisted); ` +
    `all ${checkFiles.length} check-* files referenced (${Object.keys(ORPHAN_FILE_ALLOWLIST).length} allowlisted).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
