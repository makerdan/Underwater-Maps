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
 * Hardening guarantees:
 *   - A missing or malformed baseline file fails with a clear, actionable
 *     message (never a raw ENOENT / SyntaxError stack trace).
 *   - A single unreadable test file is warned about and skipped; counting
 *     continues for all other files.
 *   - A missing scan root (renamed/moved directory) fails loudly instead of
 *     being silently treated as zero coverage.
 *
 * Usage: node scripts/check-skip-count.mjs
 * Self-test: node --test scripts/__tests__/check-skip-count.test.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { IGNORED_DIRS } from "./lib/ignored-dirs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const BASELINE_PATH = resolve(root, "tests/skip-baseline.json");

const UNIT_DIRS = ["artifacts", "lib", "scripts"];
const UNIT_FILE_RE = /\.test\.(ts|tsx|mjs)$/;
const UNIT_SKIP_IDENTIFIERS = ["it", "test", "describe"];

const E2E_DIR = "tests/e2e";
const E2E_FILE_RE = /\.tsx?$/;
const E2E_SKIP_IDENTIFIERS = ["test"];

// IGNORED_DIRS is imported from ./lib/ignored-dirs.mjs — do not re-declare locally.

let hadErrors = false;

function warnWalkError(operation, path, err) {
  if (err?.code === "ENOENT") {
    console.warn(
      `[check-skip-count] WARN — could not ${operation} ${path}: ${err.message}; skipping this entry.`,
    );
    return;
  }
  hadErrors = true;
  console.error(
    `[check-skip-count] WARN — could not ${operation} ${path}: ${err?.message ?? err}; ` +
      `the skip count may be incomplete.`,
  );
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    warnWalkError("read directory", dir, err);
    return;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch (err) {
      warnWalkError("stat", p, err);
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

/**
 * Count executable test.skip()/it.skip()/describe.skip() calls across files.
 * Comments, strings, template text and regex literals are not calls;
 * executable template interpolations are traversed.
 * Documentation cannot satisfy or mask the source-level ratchet.
 * An unreadable file is warned about and
 * skipped — one bad file must not abort counting for all the others.
 */
export function countSkipCalls(files, identifiers) {
  const skipIdentifiers = new Set(identifiers);
  const perFile = [];
  let total = 0;
  for (const f of files) {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch (err) {
      console.warn(
        `[check-skip-count] WARN — could not read ${f}: ${err?.message ?? err}; skipping this file.`,
      );
      continue;
    }
    const extension = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
    const scriptKind = extension === "tsx"
      ? ts.ScriptKind.TSX
      : extension === "ts"
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(
      f,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    if (sourceFile.parseDiagnostics.length > 0) {
      const details = sourceFile.parseDiagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("; ");
      hadErrors = true;
      console.error(
        `[check-skip-count] WARN — could not parse ${f}: ${details}; ` +
          "refusing to compare a partial skip count.",
      );
      continue;
    }

    let n = 0;
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (
          ts.isPropertyAccessExpression(expression) &&
          expression.name.text === "skip" &&
          ts.isIdentifier(expression.expression) &&
          skipIdentifiers.has(expression.expression.text)
        ) {
          n += 1;
        } else if (
          ts.isElementAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          skipIdentifiers.has(expression.expression.text) &&
          expression.argumentExpression &&
          ts.isStringLiteral(expression.argumentExpression) &&
          expression.argumentExpression.text === "skip"
        ) {
          n += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (n > 0) {
      perFile.push({ file: f, count: n });
      total += n;
    }
  }
  return { total, perFile };
}

/**
 * Read + parse the skip baseline with clear per-error diagnostics.
 * Throws an Error whose message names the offending path; never a raw
 * ENOENT / SyntaxError stack trace.
 */
export function loadBaseline(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(
        `baseline file not found at ${path} — create it or check for a merge conflict ` +
          `(expected JSON like {"unitStaticSkips": 0, "e2eSkipSites": N}).`,
      );
    }
    throw new Error(`could not read baseline file ${path}: ${err?.message ?? err}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `baseline file is not valid JSON: ${path} — fix the syntax error or check for ` +
        `a merge conflict (${err?.message ?? err}).`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `baseline file is malformed: ${path} — expected a JSON object like ` +
        `{"unitStaticSkips": 0, "e2eSkipSites": N}, got ` +
        `${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}.`,
    );
  }
  for (const key of ["unitStaticSkips", "e2eSkipSites"]) {
    const v = parsed[key];
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(
        `baseline file is malformed: ${path} — key ${JSON.stringify(key)} must be a ` +
          `non-negative integer, got ${JSON.stringify(v)}.`,
      );
    }
  }
  return parsed;
}

/**
 * Return the subset of scan roots (relative names) that are NOT existing
 * directories under rootDir. A missing root must fail the check loudly:
 * silently treating it as zero files would let skips accumulate unseen.
 */
export function findMissingScanRoots(rootDir, dirs) {
  const missing = [];
  for (const d of dirs) {
    let st;
    try {
      st = statSync(resolve(rootDir, d));
    } catch {
      missing.push(d);
      continue;
    }
    if (!st.isDirectory()) missing.push(d);
  }
  return missing;
}

function main() {
  hadErrors = false;
  const missingRoots = findMissingScanRoots(root, [...UNIT_DIRS, E2E_DIR]);
  if (missingRoots.length > 0) {
    for (const d of missingRoots) {
      console.error(
        `[check-skip-count] FAIL — scan root missing: ${JSON.stringify(d)} ` +
          `(resolved to ${resolve(root, d)}). If the directory was renamed or moved, ` +
          `update UNIT_DIRS / E2E_DIR in scripts/check-skip-count.mjs so the ratchet ` +
          `keeps covering it — a missing root must never silently count as zero skips.`,
      );
    }
    process.exit(1);
  }

  let baseline;
  try {
    baseline = loadBaseline(BASELINE_PATH);
  } catch (err) {
    console.error(`[check-skip-count] FAIL — ${err.message}`);
    process.exit(1);
  }

  const unitFiles = UNIT_DIRS.flatMap((d) =>
    [...walk(resolve(root, d))].filter((f) => UNIT_FILE_RE.test(f)),
  );
  const e2eFiles = [...walk(resolve(root, E2E_DIR))].filter((f) => E2E_FILE_RE.test(f));

  const unit = countSkipCalls(unitFiles, UNIT_SKIP_IDENTIFIERS);
  const e2e = countSkipCalls(e2eFiles, E2E_SKIP_IDENTIFIERS);

  if (hadErrors) {
    console.error(
      "[check-skip-count] FAIL — could not inspect or parse one or more scan entries; " +
        "refusing to compare a partial skip count.",
    );
    process.exit(1);
  }

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
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) main();
