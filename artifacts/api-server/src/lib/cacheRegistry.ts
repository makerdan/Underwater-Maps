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
