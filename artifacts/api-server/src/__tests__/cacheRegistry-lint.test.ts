/**
 * Lint check: every module-level `new Map` in a route or lib file must be
 * accompanied by a `registerCache` call in the same file.
 *
 * This test exists to enforce the convention documented in
 * `src/lib/cacheRegistry.ts`: any in-memory cache that persists across
 * requests must be registered so the global vitest `beforeEach` can clear it
 * between test cases.  A missed registration causes silent state-leakage
 * between tests — the original problem this registry was built to prevent.
 *
 * Both `src/routes/` and `src/lib/` are scanned **recursively**, so files
 * in subdirectories (e.g. `src/lib/intertidal/scorer.ts`) are included.
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
 * For a **route** file:
 * 1. Import `registerCache` from `"../lib/cacheRegistry.js"`.
 * 2. Call `registerCache(() => myCache.clear())` immediately after the `new Map`
 *    declaration.
 *
 * For a **lib** file (including subdirectories):
 * 1. Import `registerCache` from the appropriate relative path to
 *    `cacheRegistry.js` (e.g. `"./cacheRegistry.js"` at the top level,
 *    `"../cacheRegistry.js"` one level deep, etc.).
 * 2. Call `registerCache(() => myCache.clear())` immediately after the `new Map`
 *    declaration.
 *
 * See `src/routes/tidal.ts` for the canonical reference implementation.
 *
 * ## Excluded lib files
 *
 * `cacheRegistry.ts` itself is excluded — it is the registry definition, not
 * a consumer of it.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";

const ROUTES_DIR = join(__dirname, "..", "routes");
const LIB_DIR = join(__dirname, "..", "lib");
const FIXTURES_DIR = join(__dirname, "fixtures");

const LIB_EXCLUDES = new Set(["cacheRegistry.ts"]);

/**
 * Recursively collect all `.ts` source files (excluding `.test.ts`) under
 * `baseDir`, optionally skipping filenames listed in `excludes`.
 *
 * This is the shared scanner used by every lint path below — including the
 * regression fixture test.  Changing this function to non-recursive will
 * immediately cause the subdirectory regression test to fail.
 */
function getTsFilesRecursively(
  baseDir: string,
  excludes: Set<string> = new Set(),
): string[] {
  return (readdirSync(baseDir, { recursive: true }) as string[])
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !excludes.has(f),
    )
    .map((f) => join(baseDir, f));
}

function getRouteFiles(): string[] {
  return getTsFilesRecursively(ROUTES_DIR);
}

function getLibFiles(): string[] {
  return getTsFilesRecursively(LIB_DIR, LIB_EXCLUDES);
}

function checkFiles(files: string[], dirLabel: string): string[] {
  const violations: string[] = [];

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    const lines = source.split("\n");

    const hasModuleLevelMap = lines.some(
      (line) => /^const \w+ = new Map[<(]/.test(line),
    );

    if (!hasModuleLevelMap) continue;

    const hasRegisterCache = source.includes("registerCache(");

    if (!hasRegisterCache) {
      const fileName = filePath.split(`/${dirLabel}/`).pop() ?? filePath;
      const importHint =
        dirLabel === "routes"
          ? '"../lib/cacheRegistry.js"'
          : "the appropriate relative path to cacheRegistry.js";
      violations.push(
        `${dirLabel}/${fileName}: has a module-level "new Map" but does not call registerCache(). ` +
          `Add "registerCache(() => yourCache.clear())" after each module-level Map declaration ` +
          `and import registerCache from ${importHint}.`,
      );
    }
  }

  return violations;
}

describe("cacheRegistry lint", () => {
  it("every route file with a module-level new Map must call registerCache", () => {
    const violations = checkFiles(getRouteFiles(), "routes");
    expect(violations).toEqual([]);
  });

  it("every lib file with a module-level new Map must call registerCache", () => {
    const violations = checkFiles(getLibFiles(), "lib");
    expect(violations).toEqual([]);
  });
});

describe("cacheRegistry lint — recursive scanner regression", () => {
  /**
   * Proves that getTsFilesRecursively (the shared helper used by getRouteFiles
   * and getLibFiles above) actually descends into subdirectories.
   *
   * The fixture at fixtures/fake-subdir/nested/unregistered-map.ts contains a
   * bare module-level `new Map` with no registerCache call.  It lives inside a
   * `nested/` child directory so that a non-recursive scan of `fake-subdir`
   * would return zero files and the violation count would drop to 0 — failing
   * the assertion below and catching the regression immediately.
   */
  it("detects an unregistered Map inside a nested subdirectory fixture", () => {
    const fixtureSubdir = join(FIXTURES_DIR, "fake-subdir");
    const files = getTsFilesRecursively(fixtureSubdir);

    const violations = checkFiles(files, "fake-subdir");

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("fake-subdir/nested/unregistered-map.ts");
    expect(violations[0]).toContain('has a module-level "new Map"');
    expect(violations[0]).toContain("registerCache()");
  });
});
