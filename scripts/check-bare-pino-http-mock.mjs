#!/usr/bin/env node
/**
 * check-bare-pino-http-mock.mjs
 *
 * CI guard: fails if any test file contains a bare vi.mock("pino-http", ...)
 * factory.  Route tests must use the shared src/lib/__mocks__/logger.ts mock
 * (vi.mock("...logger.js") with no factory) instead of reimplementing a
 * per-file pino-http factory.
 *
 * Rationale: bare pino-http factories are often incomplete (missing
 * child().child() recursion) and cause route handlers to return 500 instead
 * of the expected status, masking the real failure.
 *
 * Usage (from repo root):
 *   node scripts/check-bare-pino-http-mock.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SEARCH_DIRS = [
  join(root, "artifacts/api-server/src"),
  join(root, "artifacts/bathyscan/src"),
  join(root, "tests"),
];

const BARE_MOCK_RE = /vi\.mock\(\s*['"]pino-http['"]\s*,\s*\(/;

/**
 * Recursively walks a directory and returns all .test.ts / .test.js file paths.
 */
function findTestFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (/\.(test|spec)\.(ts|js)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const violations = [];

for (const dir of SEARCH_DIRS) {
  for (const file of findTestFiles(dir)) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (BARE_MOCK_RE.test(content)) {
      violations.push(relative(root, file));
    }
  }
}

if (violations.length > 0) {
  console.error(
    "check:bare-pino-http-mock FAIL — the following test file(s) use a bare vi.mock(\"pino-http\", ...) factory:"
  );
  for (const f of violations) {
    console.error(`  ${f}`);
  }
  console.error(
    "\nUse vi.mock(\"../../lib/logger.js\") (no factory) instead so the shared\n" +
    "src/lib/__mocks__/logger.ts mock is used. It provides the recursive\n" +
    "child() chain that pino-http v10+ requires."
  );
  process.exit(1);
}

console.log(`check:bare-pino-http-mock OK — no bare pino-http mock factories found in test files`);
