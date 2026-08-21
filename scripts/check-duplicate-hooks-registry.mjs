#!/usr/bin/env node
/**
 * check-duplicate-hooks-registry.mjs
 *
 * Fast-tier guard: auto-discovers every .tsx file in artifacts/bathyscan/src/
 * (excluding __tests__ and node_modules directories) that meets the duplicate-
 * hooks sentinel threshold (>500 lines AND ≥10 hook declarations) and exits
 * non-zero if any such file is absent from the SCANNED_FILES list embedded in
 * appTsxDuplicateHooks.test.ts.
 *
 * This is a standalone companion to the in-vitest sentinel.  The vitest
 * sentinel catches the same drift, but only when the unit-test tier runs.
 * This script runs in the fast tier so drift is caught on every task, before
 * the slower unit suite.
 *
 * Usage:
 *   node scripts/check-duplicate-hooks-registry.mjs
 *
 * Exit 0 — all qualifying files are registered.
 * Exit 1 — one or more qualifying files are missing from SCANNED_FILES.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const TEST_FILE = resolve(
  root,
  "artifacts/bathyscan/src/__tests__/appTsxDuplicateHooks.test.ts",
);
const SRC_DIR = resolve(root, "artifacts/bathyscan/src");

/** Minimum line count for a file to be considered "large". */
const MIN_LINES = 500;

/** Minimum hook declarations for a file to be considered "high risk". */
const MIN_HOOKS = 10;

/** Regex to count hook declarations (mirrors HOOK_COUNT_RE in the test file). */
const HOOK_COUNT_RE =
  /^\s*(?:const|let|var)\s+(?:\w+|\[[^\]\n]+\]|\{[^}\n]+\})\s*=\s*use[A-Z]\w*\s*(?:<[^>\n]+>\s*)?\(/gm;

// ---------------------------------------------------------------------------
// Parse SCANNED_FILES from the test source
// ---------------------------------------------------------------------------

/**
 * Extracts the SCANNED_FILES array entries from the test file by scanning for
 * the array literal between `const SCANNED_FILES: string[] = [` and the
 * matching `];`.  Uses plain string scanning — no full TS parse required.
 *
 * @param {string} src — full source text of appTsxDuplicateHooks.test.ts
 * @returns {Set<string>} — set of relative paths (forward-slash, no leading /)
 */
function parseScannedFiles(src) {
  const startMarker = "const SCANNED_FILES: string[] = [";
  const start = src.indexOf(startMarker);
  if (start === -1) {
    throw new Error(
      `[check:duplicate-hooks-registry] Could not find SCANNED_FILES array in ${TEST_FILE}`,
    );
  }
  const arrayStart = start + startMarker.length;
  const end = src.indexOf("];", arrayStart);
  if (end === -1) {
    throw new Error(
      `[check:duplicate-hooks-registry] Could not find closing ]; for SCANNED_FILES in ${TEST_FILE}`,
    );
  }

  const arrayBody = src.slice(arrayStart, end);
  const entries = new Set();
  // Match string literals inside the array
  for (const m of arrayBody.matchAll(/"([^"]+)"/g)) {
    entries.add(m[1]);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Walk src/ collecting .tsx files
// ---------------------------------------------------------------------------

/** @param {string} dir @returns {string[]} absolute paths */
function collectTsxFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      results.push(...collectTsxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const testSrc = readFileSync(TEST_FILE, "utf-8");
const scannedFiles = parseScannedFiles(testSrc);

const allTsx = collectTsxFiles(SRC_DIR);
const missing = [];

for (const absPath of allTsx) {
  const src = readFileSync(absPath, "utf-8");
  const lineCount = src.split("\n").length;
  if (lineCount <= MIN_LINES) continue;

  const hookMatches = src.match(HOOK_COUNT_RE);
  const hookCount = hookMatches ? hookMatches.length : 0;
  if (hookCount < MIN_HOOKS) continue;

  // Normalise to forward-slash relative path (matches SCANNED_FILES entries)
  const relPath = relative(SRC_DIR, absPath).split(/[\\/]/).join("/");
  if (!scannedFiles.has(relPath)) {
    missing.push(`  ${relPath} (${lineCount} lines, ${hookCount} hook declarations)`);
  }
}

if (missing.length > 0) {
  console.error(
    `[check:duplicate-hooks-registry] FAIL — ${missing.length} qualifying file(s) not in SCANNED_FILES.`,
  );
  console.error(
    `Threshold: >${MIN_LINES} lines AND ≥${MIN_HOOKS} hook declarations.\n`,
  );
  for (const m of missing) console.error(m);
  console.error(
    `\nFix: add the file path(s) above to the SCANNED_FILES array in\n` +
      `  artifacts/bathyscan/src/__tests__/appTsxDuplicateHooks.test.ts`,
  );
  process.exit(1);
}

console.log(
  `[check:duplicate-hooks-registry] OK — all qualifying .tsx files are registered ` +
    `(${scannedFiles.size} in SCANNED_FILES, scanned ${allTsx.length} total .tsx files).`,
);
