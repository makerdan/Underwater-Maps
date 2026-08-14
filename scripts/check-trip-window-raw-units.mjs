#!/usr/bin/env node
/**
 * check-trip-window-raw-units.mjs
 *
 * CI guard: fails if TripWindowPanel.tsx ever contains raw unit-literal
 * suffixes or direct .toFixed() calls on the raw knot/metre values that
 * should be formatted through the approved unit-formatter helpers.
 *
 * Background: Task #3726 replaced hardcoded "kn" / "m" suffix strings in
 * TripWindowPanel.tsx with formatSpeedFromKnots() and formatWaveHeight()
 * calls. This guard prevents the pattern from silently regressing — e.g. a
 * future contributor adding a new wind or wave display value and pasting the
 * old raw-string pattern instead of calling the approved helpers.
 *
 * Approved formatters (will NOT trigger this guard):
 *   formatSpeedFromKnots(value)   — for wind speed (converts kt → user units)
 *   formatWaveHeight(value)       — for wave height (converts m → user units)
 *
 * Forbidden patterns detected:
 *   1. Raw unit suffix string literals: ' kn', " kn", ' m ', " m "
 *      (space-delimited to avoid false-positives on "m" inside identifiers)
 *   2. Direct .toFixed( on the raw field values: maxWindKt.toFixed(
 *   3. Direct .toFixed( on the raw field values: maxWaveM.toFixed(
 *
 * Usage (from repo root):
 *   node scripts/check-trip-window-raw-units.mjs
 *
 * Self-test:
 *   node --test scripts/__tests__/check-trip-window-raw-units.test.mjs
 *   (run automatically by the `check:trip-window-raw-units` npm script before
 *   the real scan, so a broken detector fails loudly instead of silently)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "..");

/** Relative path (from repo root) of the guarded file. */
export const GUARDED_FILE = "artifacts/bathyscan/src/components/TripWindowPanel.tsx";

/**
 * Forbidden patterns with human-readable descriptions.
 * Each entry: { re: RegExp, description: string }
 *
 * The regexes are applied line-by-line so match indices correspond to the
 * source line, not a global position in the file.
 */
export const FORBIDDEN_PATTERNS = [
  {
    re: /['"] kn['"]/,
    description: "raw ' kn' / \" kn\" unit suffix literal — use formatSpeedFromKnots() instead",
  },
  {
    re: /['"] m ['"]/,
    description: "raw ' m ' / \" m \" unit suffix literal — use formatWaveHeight() instead",
  },
  {
    re: /maxWindKt\.toFixed\(/,
    description: "direct maxWindKt.toFixed() — use formatSpeedFromKnots(maxWindKt) instead",
  },
  {
    re: /maxWaveM\.toFixed\(/,
    description: "direct maxWaveM.toFixed() — use formatWaveHeight(maxWaveM) instead",
  },
];

/**
 * Scans source text for forbidden patterns.
 *
 * @param {string} src Full file text.
 * @returns {{ line: number, col: number, text: string, description: string }[]}
 */
export function findViolations(src) {
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    for (const { re, description } of FORBIDDEN_PATTERNS) {
      const m = re.exec(lineText);
      if (m) {
        violations.push({
          line: i + 1,
          col: m.index + 1,
          text: lineText.trim(),
          description,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Main (only runs when invoked directly)
// ---------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const filePath = resolve(repoRoot, GUARDED_FILE);
  let src;
  try {
    src = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`check:trip-window-raw-units FAIL — could not read ${GUARDED_FILE}: ${err.message}`);
    process.exit(1);
  }

  const violations = findViolations(src);
  if (violations.length > 0) {
    console.error(
      `check:trip-window-raw-units FAIL — ${GUARDED_FILE} contains forbidden raw-unit patterns:`,
    );
    for (const v of violations) {
      console.error(`  line ${v.line}:${v.col}  ${v.description}`);
      console.error(`    ${v.text}`);
    }
    console.error(
      "\nUse formatSpeedFromKnots() for wind speed and formatWaveHeight() for wave\n" +
      "height — both are already imported in TripWindowPanel.tsx.",
    );
    process.exit(1);
  }

  const rel = relative(repoRoot, filePath);
  console.log(`check:trip-window-raw-units OK — no forbidden raw-unit patterns found in ${rel}`);
}
