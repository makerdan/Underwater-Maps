/**
 * Thin, zero-dependency registry so `useFlyControls` can share its
 * `resetCamera` callback with the test-helper bridge without importing the
 * full `testHelpers` module (which pulls in `queryClient` and breaks unit
 * tests that mock `@tanstack/react-query` without `QueryClient`).
 *
 * Used in production-code import chains (useFlyControls → here).
 * `testHelpers.ts` reads from here via `callRegisteredResetCamera()`.
 */

let _fn: (() => void) | null = null;

/** Register (or clear) the live `resetCamera` callback from `useFlyControls`. */
export function registerResetCameraFn(fn: (() => void) | null): void {
  _fn = fn;
}

/**
 * Invoke the registered `resetCamera` callback.
 * Returns `true` when the callback was present and called,
 * `false` when `useFlyControls` has not yet mounted.
 */
export function callRegisteredResetCamera(): boolean {
  if (!_fn) return false;
  _fn();
  return true;
}
