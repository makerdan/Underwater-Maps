#!/usr/bin/env node
/**
 * check-skip-count.mjs — skip-count ratchet guard.
 *
 * Counts test-skip call sites and fails when either count rises above the
 * recorded baseline in tests/skip-baseline.json, so new silent skips are
 * surfaced immediately instead of accumulating as invisible test debt.
 *
 * Two counters:
 *   unitStaticSkips — `it.skip(` / `test.skip(` / `describe.skip(` in unit
 *       test files (*.test.ts / *.test.tsx / *.test.mjs) under artifacts/,
 *       lib/, and scripts/. Baseline is 0: permanently skipped unit tests
 *       must be rewritten or deleted, never parked. (Conditional `.skipIf(`
 *       gates are NOT counted — they self-re-enable when their condition
 *       clears.)
 *   e2eSkipSites — `test.skip(` call sites in tests/e2e/. These are
 *       conditional environment gates (see tests/e2e/SKIP-AUDIT.md); the
 *       baseline pins their number so any newly added gate is a conscious,
 *       reviewed decision.
 *
 * When a count DROPS below baseline the check passes but prints a reminder
 * to ratchet the baseline down in the same commit.
 *
 * Usage: node scripts/check-skip-count.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const BASELINE_PATH = resolve(root, "tests/skip-baseline.json");

const UNIT_DIRS = ["artifacts", "lib", "scripts"];
const UNIT_FILE_RE = /\.test\.(ts|tsx|mjs)$/;
const UNIT_SKIP_RE = /\b(?:it|test|describe)\.skip\(/g;

const E2E_DIR = "tests/e2e";
const E2E_FILE_RE = /\.ts$/;
const E2E_SKIP_RE = /\btest\.skip\(/g;

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", "test-results", "playwright-report"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

function countMatches(files, re) {
  const perFile = [];
  let total = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const n = (text.match(re) ?? []).length;
    if (n > 0) {
      perFile.push({ file: f, count: n });
      total += n;
    }
  }
  return { total, perFile };
}

const unitFiles = UNIT_DIRS.flatMap((d) =>
  [...walk(resolve(root, d))].filter((f) => UNIT_FILE_RE.test(f)),
);
const e2eFiles = [...walk(resolve(root, E2E_DIR))].filter((f) => E2E_FILE_RE.test(f));

const unit = countMatches(unitFiles, UNIT_SKIP_RE);
const e2e = countMatches(e2eFiles, E2E_SKIP_RE);

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

let failed = false;

function report(label, key, actual, detail) {
  const expected = baseline[key];
  if (typeof expected !== "number") {
    console.error(`[check-skip-count] FAIL — baseline key ${JSON.stringify(key)} missing from tests/skip-baseline.json`);
    failed = true;
    return;
  }
  if (actual.total > expected) {
    failed = true;
    console.error(
      `[check-skip-count] FAIL — ${label}: ${actual.total} skip site(s), baseline is ${expected}.\n` +
      `  New skips must not be added silently. Either fix/remove the skipped test, or —\n` +
      `  if the skip is a deliberate, documented environment gate (${detail}) —\n` +
      `  raise ${JSON.stringify(key)} in tests/skip-baseline.json in the same commit.`,
    );
    for (const { file, count } of actual.perFile) {
      console.error(`    ${count}× ${file.slice(root.length + 1)}`);
    }
  } else if (actual.total < expected) {
    console.log(
      `[check-skip-count] NOTE — ${label}: ${actual.total} skip site(s), below baseline ${expected}. ` +
      `Ratchet ${JSON.stringify(key)} down in tests/skip-baseline.json to lock in the improvement.`,
    );
  } else {
    console.log(`[check-skip-count] OK — ${label}: ${actual.total} skip site(s) (baseline ${expected}).`);
  }
}

report(
  "unit static skips (it/test/describe.skip)",
  "unitStaticSkips",
  unit,
  "prefer .skipIf(condition) for unit tests so they self-re-enable",
);
report(
  "e2e conditional test.skip call sites",
  "e2eSkipSites",
  e2e,
  "must carry a message and match a category in tests/e2e/SKIP-AUDIT.md",
);

process.exit(failed ? 1 : 0);
