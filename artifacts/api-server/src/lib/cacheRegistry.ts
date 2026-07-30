/**
 * A lightweight registry for module-level in-memory caches.
 *
 * Each module that owns a cache calls `registerCache` once at module-init
 * time, passing in a function that clears the cache.  The test setup file
 * then calls `clearAllCaches()` in a global `beforeEach` so every test
 * starts with a clean slate — no per-test boilerplate required.
 *
 * Production code never calls `clearAllCaches`; the registry is inert at
 * runtime except for the tiny slice of memory used to hold the callback set.
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

import { logger } from "./logger.js";

// Use a Set so the same callback reference can only be registered once.
// Duplicate registrations (e.g. from module hot-reloads or accidental
// double-imports) are silently ignored rather than doubling clear work.
const clearFns: Set<() => void> = new Set();

/**
 * Register a cache-clearing function.  Call this once per cache at module
 * initialisation time.  Duplicate registrations of the same callback
 * reference are ignored.
 *
 * @param fn  A zero-argument function that empties the cache.
 */
export function registerCache(fn: () => void): void {
  clearFns.add(fn);
}

/**
 * Unregister a previously registered cache-clearing function.  This is
 * rarely needed in production code but is useful in tests that create
 * temporary caches to avoid polluting the global registry.
 *
 * @param fn  The same function reference passed to `registerCache`.
 */
export function unregisterCache(fn: () => void): void {
  clearFns.delete(fn);
}

/**
 * Clear every registered cache.  Called automatically by the vitest global
 * setup file before each test — production code should not call this.
 *
 * Individual callback failures are caught, logged, and skipped so that one
 * broken cache-clear does not prevent the remaining caches from being reset.
 */
export function clearAllCaches(): void {
  for (const fn of clearFns) {
    try {
      fn();
    } catch (err) {
      logger.error(
        { err },
        "[cacheRegistry] clearAllCaches: a cache-clear callback threw — continuing with remaining caches",
      );
    }
  }
}
