/**
 * A lightweight registry for module-level in-memory caches.
 *
 * Each module that owns a cache calls `registerCache` once at module-init
 * time, passing in a function that clears the cache.  The test setup file
 * then calls `clearAllCaches()` in a global `beforeEach` so every test
 * starts with a clean slate — no per-test boilerplate required.
 *
 * Production code never calls `clearAllCaches`; the registry is inert at
 * runtime except for the tiny slice of memory used to hold the callback list.
 *
 * ## Convention — every module-level cache MUST be registered
 *
 * If your route or lib file declares a module-level `Map` (or any other
 * in-memory store whose contents persist across requests), you MUST register
 * a clearing function here at module-init time:
 *
 * ```ts
 * import { registerCache } from "../lib/cacheRegistry.js";
 *
 * const myCache = new Map<string, MyValue>();
 * registerCache(() => myCache.clear());
 * ```
 *
 * Skipping this registration means the cache will survive between test cases,
 * causing the exact state-leakage problem that this registry was created to
 * solve.  The CI test `src/__tests__/cacheRegistry-lint.test.ts` will fail if
 * it finds a module-level `new Map` in any route file that does not also call
 * `registerCache`.
 *
 * See `src/routes/tidal.ts` for the canonical reference implementation.
 */

const clearFns: Array<() => void> = [];

/**
 * Register a cache-clearing function.  Call this once per cache at module
 * initialisation time.
 *
 * @param fn  A zero-argument function that empties the cache.
 */
export function registerCache(fn: () => void): void {
  clearFns.push(fn);
}

/**
 * Clear every registered cache.  Called automatically by the vitest global
 * setup file before each test — production code should not call this.
 */
export function clearAllCaches(): void {
  for (const fn of clearFns) {
    fn();
  }
}
