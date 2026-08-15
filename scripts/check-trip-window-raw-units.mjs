#!/usr/bin/env node
/**
 * check-trip-window-raw-units.mjs
 *
 * CI guard: fails if any surface-condition panel ever contains raw unit-literal
 * suffixes or direct .toFixed() calls on the raw knot/metre values that should
 * be formatted through the approved unit-formatter helpers.
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
 * General forbidden patterns (applied to ALL guarded files):
 *   1. Raw unit suffix string literals: ' kn', " kn", ' m ', " m "
 *      (space-delimited to avoid false-positives on "m" inside identifiers)
 *
 * TripWindowPanel-only forbidden patterns (additional guards for that file):
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

/**
 * All surface-condition panel files that call formatSpeedFromKnots or
 * formatWaveHeight and therefore must never regress to raw unit literals.
 */
export const GUARDED_FILES = [
  "artifacts/bathyscan/src/components/TripWindowPanel.tsx",
  "artifacts/bathyscan/src/components/ConditionsLegend.tsx",
  "artifacts/bathyscan/src/components/DriftTimeline.tsx",
  "artifacts/bathyscan/src/components/WeatherPanel.tsx",
  "artifacts/bathyscan/src/components/CurrentsPanel.tsx",
  "artifacts/bathyscan/src/components/ManualConditionsForm.tsx",
  "artifacts/bathyscan/src/components/TidePanel.tsx",
];

/** Backward-compat alias — the originally guarded file. */
export const GUARDED_FILE = GUARDED_FILES[0];

/**
 * Patterns that apply to ALL guarded files.
 * These catch the most common regression: pasting a raw unit literal instead
 * of calling the approved formatter helper.
 *
 * Six pattern classes are covered:
 *   1. Quoted string literals containing ' kn' / " kn" (original guard)
 *   2. Quoted string literals containing ' m ' / " m " (original guard)
 *   3. Template-literal/JSX interpolations ending in raw } kn
 *      (e.g. `Wind ${val} kn @`)
 *   4. Template-literal/JSX interpolations ending in raw } kt or } KT
 *      (e.g. `DRIFT @ ${speed.toFixed(1)} KT`)
 *   5. Any function-call result displayed with a raw metre suffix in a
 *      template-literal interpolation (e.g. `${val.toFixed(2)} m` or
 *      `${Math.round(val)} m`)
 *   6. No-space raw 'm' suffix directly after a JSX expression close brace
 *      (e.g. `{lineLengthM}m`)
 *
 * Lines containing the token `raw-unit-ok` are suppressed (see findViolations).
 */
export const GENERAL_PATTERNS = [
  // ── Quoted string literal speed patterns ──────────────────────────────────
  {
    re: /['"] kn['"]/,
    description: "raw ' kn' / \" kn\" speed suffix in quoted string — use formatSpeedFromKnots() instead",
  },
  {
    re: /['"] [kK][tT]\b/,
    description: "raw ' kt' / \" KT\" speed suffix in quoted string — use formatSpeedFromKnots() instead",
  },
  // ── Quoted string literal metre pattern ───────────────────────────────────
  // Catches both ' m ' / " m " (mid-string) and ' m' / " m" (end-of-string).
  {
    re: /['"] m\b/,
    description: "raw metre suffix in quoted string literal — use formatWaveHeight() or formatDepth() instead",
  },
  // ── Template-literal / JSX expression speed patterns ─────────────────────
  {
    re: /\} kn\b/,
    description: "raw 'kn' speed suffix after JSX/template expression — use formatSpeedFromKnots() instead",
  },
  {
    re: /\}\s*[Kk][Tt]\b/,
    description: "raw 'kt'/'KT' speed suffix after JSX/template expression — use formatSpeedFromKnots() instead",
  },
  // ── Template-literal / JSX expression metre pattern ───────────────────────
  // Unified form: catches no-space {val}m, spaced {val} m, and function-call
  // result ${fn()} m — all raw metre displays that bypass the formatters.
  {
    re: /\}\s*m\b/,
    description: "raw metre suffix after JSX/template expression — use formatWaveHeight() or formatDepth() instead",
  },
];

/**
 * Additional patterns applied only to TripWindowPanel.tsx.
 * These guard the specific field names that were replaced in task #3726.
 */
export const TRIP_WINDOW_EXTRA_PATTERNS = [
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
 * Full pattern set for TripWindowPanel.tsx (general + TripWindow-specific).
 * Exported for backward compatibility with existing tests.
 *
 * @deprecated Use GENERAL_PATTERNS + TRIP_WINDOW_EXTRA_PATTERNS separately.
 */
export const FORBIDDEN_PATTERNS = [...GENERAL_PATTERNS, ...TRIP_WINDOW_EXTRA_PATTERNS];

/**
 * Scans source text for forbidden patterns.
 *
 * Per-line suppression: any source line that contains the token `raw-unit-ok`
 * (in any comment form, e.g. `// raw-unit-ok` or a block comment) is skipped
 * entirely. Use this sparingly — only for code paths where a raw unit is
 * genuinely correct (e.g. a GPX export that must use SI units, or a time-
 * duration display where "m" means minutes, not metres).
 *
 * @param {string} src Full file text.
 * @param {{ re: RegExp, description: string }[]} [patterns] Patterns to apply.
 *   Defaults to FORBIDDEN_PATTERNS (full set) for backward compatibility.
 * @returns {{ line: number, col: number, text: string, description: string }[]}
 */
export function findViolations(src, patterns = FORBIDDEN_PATTERNS) {
  const violations = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    // Per-line opt-out: skip lines explicitly marked as intentionally raw.
    if (lineText.includes("raw-unit-ok")) continue;
    for (const { re, description } of patterns) {
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
  let totalViolations = 0;

  for (const guardedFile of GUARDED_FILES) {
    const filePath = resolve(repoRoot, guardedFile);
    let src;
    try {
      src = readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`check:trip-window-raw-units FAIL — could not read ${guardedFile}: ${err.message}`);
      process.exit(1);
    }

    // TripWindowPanel gets the full pattern set; all others get the general patterns.
    const patterns =
      guardedFile === GUARDED_FILE ? FORBIDDEN_PATTERNS : GENERAL_PATTERNS;

    const violations = findViolations(src, patterns);
    if (violations.length > 0) {
      console.error(
        `check:trip-window-raw-units FAIL — ${guardedFile} contains forbidden raw-unit patterns:`,
      );
      for (const v of violations) {
        console.error(`  line ${v.line}:${v.col}  ${v.description}`);
        console.error(`    ${v.text}`);
      }
      totalViolations += violations.length;
    } else {
      const rel = relative(repoRoot, filePath);
      console.log(`check:trip-window-raw-units OK — ${rel}`);
    }
  }

  if (totalViolations > 0) {
    console.error(
      "\nUse formatSpeedFromKnots() for wind speed and formatWaveHeight() for wave\n" +
      "height — both are already imported in the respective panel files.",
    );
    process.exit(1);
  }
}
