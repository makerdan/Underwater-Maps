/**
 * Suppress the THREE.Clock deprecation warning emitted by @react-three/fiber
 * (≤ v9.x) on every page load. R3F v9 instantiates THREE.Clock at module
 * evaluation time; the warning is harmless and cannot be fixed without
 * upgrading to R3F v10 (still in canary as of 2026-06).
 *
 * This module MUST be imported before any import that transitively pulls in
 * three / @react-three/fiber so that the patch is in place before those
 * modules evaluate.  Remove this file and its import in main.tsx once R3F v10
 * is stable and the project has been upgraded.
 */

const _originalWarn = console.warn.bind(console);

console.warn = (...args: unknown[]): void => {
  if (
    args[0] === "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead."
  ) {
    return;
  }
  _originalWarn(...args);
};
