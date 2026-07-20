/**
 * Suppress the THREE.Clock deprecation warning emitted by @react-three/fiber
 * (v9.x) on every page load.
 *
 * Root cause
 * ----------
 * three.js deprecated THREE.Clock in r168 (v0.168.0) in favour of
 * THREE.Timer. @react-three/fiber v9 still instantiates THREE.Clock at module
 * evaluation time, which causes the warning below on every page load:
 *
 *   THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
 *
 * Version status (verified 2026-07-20)
 * -------------------------------------
 * | Package                | Installed | Peer requirement             |
 * |------------------------|-----------|------------------------------|
 * | three                  | 0.184.0   | —                            |
 * | @react-three/fiber     | 9.6.1     | three >=0.156 (satisfied ✓)  |
 * | @react-three/drei      | 10.7.7    | fiber ^9.0.0 (satisfied ✓)   |
 * |                        |           | three >=0.159 (satisfied ✓)  |
 *
 * All peer dependencies are satisfied — there are no unresolved peer warnings.
 * The versions are mutually consistent.
 *
 * Why suppress instead of upgrade
 * --------------------------------
 * @react-three/fiber v10 (which uses THREE.Timer natively) was still in
 * canary/alpha only as of 2026-07-20 (latest stable = v9.6.1).  Upgrading
 * to a canary release would introduce unacceptable instability risk.  The
 * suppress-and-guard pattern is the correct stopgap:
 *   1. This module silences the console noise at runtime (see import order
 *      below — it MUST be the first import in main.tsx).
 *   2. An ESLint `no-restricted-syntax` rule in eslint.config.mjs prevents
 *      first-party code from ever calling `new THREE.Clock(...)`.
 *   3. A follow-up task tracks the r3f v10 upgrade for when it ships stable.
 *
 * Import order requirement
 * ------------------------
 * This module MUST be the first import in main.tsx so the console.warn patch
 * is in place before three.js / @react-three/fiber evaluate. Moving it after
 * any r3f or three import would miss the warning.
 *
 * Removal
 * -------
 * Delete this file and its import in main.tsx once @react-three/fiber v10
 * ships as stable and the project has been upgraded. The ESLint rule in
 * eslint.config.mjs should be kept as a permanent regression guard.
 */

const _originalWarn = console.warn.bind(console);

console.warn = (...args: unknown[]): void => {
  if (
    args[0] ===
    "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead."
  ) {
    return;
  }
  _originalWarn(...args);
};
