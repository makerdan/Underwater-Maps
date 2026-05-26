/**
 * Lint check: every module-level `new Map` in a route file must be accompanied
 * by a `registerCache` call in the same file.
 *
 * This test exists to enforce the convention documented in
 * `src/lib/cacheRegistry.ts`: any in-memory cache that persists across
 * requests must be registered so the global vitest `beforeEach` can clear it
 * between test cases.  A missed registration causes silent state-leakage
 * between tests — the original problem this registry was built to prevent.
 *
 * ## What counts as a "module-level Map"?
 *
 * A line that starts with `const` at column 0 (no leading whitespace) and
 * contains `new Map` is treated as a module-level cache declaration.  Maps
 * created inside functions or arrow-function bodies are always indented, so
 * they are not matched.
 *
 * ## How to fix a failure
 *
 * 1. Import `registerCache` from `"../lib/cacheRegistry.js"` in the offending
 *    route file.
 * 2. Call `registerCache(() => myCache.clear())` immediately after the `new Map`
 *    declaration.
 *
 * See `src/routes/tidal.ts` for the canonical reference implementation.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const ROUTES_DIR = join(__dirname, "..", "routes");

function getRouteFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(ROUTES_DIR, f));
}

describe("cacheRegistry lint", () => {
  it("every route file with a module-level new Map must call registerCache", () => {
    const violations: string[] = [];

    for (const filePath of getRouteFiles()) {
      const source = readFileSync(filePath, "utf8");
      const lines = source.split("\n");

      const hasModuleLevelMap = lines.some(
        (line) => /^const \w+ = new Map[<(]/.test(line),
      );

      if (!hasModuleLevelMap) continue;

      const hasRegisterCache = source.includes("registerCache(");

      if (!hasRegisterCache) {
        const fileName = filePath.replace(ROUTES_DIR + "/", "");
        violations.push(
          `routes/${fileName}: has a module-level "new Map" but does not call registerCache(). ` +
            `Add "registerCache(() => yourCache.clear())" after each module-level Map declaration ` +
            `and import registerCache from "../lib/cacheRegistry.js".`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
