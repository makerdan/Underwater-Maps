/**
 * ignored-dirs.mjs — canonical directory-ignore list for check-script walkers.
 *
 * All walker check scripts (check-*.mjs) that traverse the repo tree MUST
 * import IGNORED_DIRS from here instead of declaring a local copy.  This
 * prevents the per-script copies from silently drifting apart when a new
 * generated-output directory is added.
 *
 * If a check script needs additional entries beyond the base set (e.g.
 * "build", "__mocks__"), construct a local SKIP_DIRS (note the different
 * name, so the re-declaration guard does not fire) by spreading this set:
 *
 *   import { IGNORED_DIRS } from "./lib/ignored-dirs.mjs";
 *   const SKIP_DIRS = new Set([...IGNORED_DIRS, "build", "__mocks__"]);
 *
 * Never re-declare a local constant named IGNORED_DIRS — the guard in
 * check-runner-step-sync.mjs will fail the check:runner-step-sync CI step
 * if it detects such a re-declaration.
 */

export const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "test-results",
  "playwright-report",
  "coverage",
]);
