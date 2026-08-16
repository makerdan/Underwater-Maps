/**
 * tier-lock-check.mjs — shared helper for run-locked-tier --dry-run pre-checks.
 *
 * Both run-tier.mjs and test-heavy-serial.mjs need to:
 *   1. Invoke `run-locked-tier.mjs --dry-run <planFile>` via spawnSync.
 *   2. Handle exit code 2 (no ## Validation section → graceful degradation).
 *   3. Handle non-zero exit (tier missing/malformed → VIOLATION).
 *   4. Parse the resolved tier name from stdout with a shared regex.
 *
 * Centralising the regex here means a log-format change in run-locked-tier.mjs
 * only needs to be updated in one place to fix both callers.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runLockedTierScript = resolve(__dirname, "..", "run-locked-tier.mjs");

/**
 * Regex that matches the tier-name in the dry-run output line:
 *   run-locked-tier [--dry-run] resolved tier "X" → command: ...
 */
export const TIER_RESOLVED_RE = /resolved tier "([^"]+)"/;

/**
 * Result shapes returned by runTierLockDryRun.
 *
 * @typedef {{ kind: "no-plan-file" }} NoPlanFile
 * @typedef {{ kind: "no-validation-section"; output: string }} NoValidationSection
 * @typedef {{ kind: "violation"; output: string }} Violation
 * @typedef {{ kind: "unparseable"; output: string }} Unparseable
 * @typedef {{ kind: "ok"; tierName: string }} Ok
 * @typedef {NoPlanFile | NoValidationSection | Violation | Unparseable | Ok} TierLockResult
 */

/**
 * Runs `run-locked-tier.mjs --dry-run <planFile>` synchronously and returns a
 * typed result object describing the outcome.  Does NOT print anything or call
 * process.exit() — that responsibility stays with the caller.
 *
 * @param {string | undefined} planFile - value of TASK_PLAN_FILE (may be undefined)
 * @returns {TierLockResult}
 */
export function runTierLockDryRun(planFile) {
  if (!planFile) {
    return { kind: "no-plan-file" };
  }

  const dryResult = spawnSync(
    process.execPath,
    [runLockedTierScript, "--dry-run", planFile],
    { encoding: "utf8" },
  );

  const output = (dryResult.stderr || dryResult.stdout || "").trim();

  if (dryResult.status === 2) {
    // Plan file exists but has no ## Validation section — old plan.
    return { kind: "no-validation-section", output };
  }

  if (dryResult.status !== 0) {
    // tier name is missing, malformed, or not registered.
    return { kind: "violation", output };
  }

  const m = (dryResult.stdout || "").match(TIER_RESOLVED_RE);
  if (!m) {
    return { kind: "unparseable", output: (dryResult.stdout || "").trim() };
  }

  return { kind: "ok", tierName: m[1] };
}
