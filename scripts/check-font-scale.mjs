#!/usr/bin/env node
/**
 * check-font-scale.mjs
 *
 * CI guard: fails if any non-test source file in artifacts/bathyscan/src
 * contains a bare numeric `fontSize:` object property — e.g. `fontSize: 14`.
 *
 * The Text Size accessibility setting is applied via the `--bs-font-scale` CSS
 * variable.  Every inline `fontSize` must therefore use the calc() pattern:
 *
 *   fontSize: "calc(14px * var(--bs-font-scale, 1))"
 *
 * A bare numeric value (e.g. `fontSize: 14`) silently ignores the setting.
 *
 * Intentional exemptions (not flagged by this guard):
 *   - JSX/TSX attribute syntax: `<Text fontSize={14} />` or `fontSize={14}`
 *     — these use `=` not `:`, so the pattern never matches.
 *   - drei <Text> and SVG fontSize attributes are the common source of the
 *     JSX attribute form and are already exempt for the same reason.
 *   - Test files (any path containing __tests__, .test., or .spec.).
 *   - Comment-only lines (// … or /* …).
 *
 * Usage:
 *   node scripts/check-font-scale.mjs
 *
 * Self-test:
 *   node --test scripts/__tests__/check-font-scale.test.mjs
 *   (run automatically by the `check:font-scale` npm script before the real
 *   scan, so a broken detector fails loudly instead of passing quietly)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, "..");

export const SCAN_ROOT = "artifacts/bathyscan/src";

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "__mocks__",
]);

/**
 * Regex that matches a bare numeric `fontSize:` object property.
 *
 * Matches:
 *   fontSize: 14
 *   fontSize : 14
 *   fontSize:14
 *
 * Does NOT match:
 *   fontSize: "calc(14px * var(--bs-font-scale, 1))"  ← compliant form
 *   fontSize={14}                                      ← JSX attr (uses =)
 *   fontSize: someVariable                             ← non-literal
 *   // fontSize: 14                                    ← comment (skipped below)
 */
export const BARE_FONT_SIZE_RE = /\bfontSize\s*:\s*\d/;

/** Lines whose first non-whitespace token is a line- or block-comment are skipped. */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

/** Returns true for paths that should be excluded from the scan. */
export function isTestFile(relPath) {
  const parts = relPath.split("/");
  if (parts.includes("__tests__")) return true;
  const basename = parts[parts.length - 1];
  return basename.includes(".test.") || basename.includes(".spec.");
}

/** Recursively yields absolute file paths under `dir`, skipping SKIP_DIRS. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

/**
 * Scan `src` text for bare numeric fontSize: violations.
 * Returns an array of { line (1-based), text } objects.
 */
export function findViolations(src) {
  const violations = [];
  const lines = src.split("\n");
  lines.forEach((line, idx) => {
    if (COMMENT_LINE_RE.test(line)) return;
    if (BARE_FONT_SIZE_RE.test(line)) {
      violations.push({ line: idx + 1, text: line.trim() });
    }
  });
  return violations;
}

// ── CLI entry point ────────────────────────────────────────────────────────

function main() {
  const absRoot = join(repoRoot, SCAN_ROOT);
  const fileViolations = [];
  let totalFiles = 0;

  for (const file of walk(absRoot)) {
    const rel = relative(repoRoot, file).split("\\").join("/");
    if (isTestFile(rel)) continue;
    totalFiles++;

    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hits = findViolations(src);
    if (hits.length > 0) {
      fileViolations.push({ file: rel, hits });
    }
  }

  if (fileViolations.length > 0) {
    console.error("check:font-scale FAIL — bare numeric fontSize: value(s) found:\n");
    for (const { file, hits } of fileViolations) {
      for (const { line, text } of hits) {
        console.error(`  ${file}:${line}`);
        console.error(`      ${text}`);
      }
    }
    console.error(
      `\n${fileViolations.reduce((n, f) => n + f.hits.length, 0)} violation(s).\n` +
      `\n` +
      `Inline fontSize must use the calc() pattern so the Text Size\n` +
      `accessibility setting (--bs-font-scale) is applied:\n` +
      `\n` +
      `  BAD:  fontSize: 14\n` +
      `  GOOD: fontSize: "calc(14px * var(--bs-font-scale, 1))"\n` +
      `\n` +
      `Exemptions: JSX/TSX attribute syntax (fontSize={N}) is not flagged\n` +
      `because it uses = not :. drei <Text> and SVG fontSize attrs are the\n` +
      `common source of that form and are intentionally excluded.\n` +
      `See .agents/memory/font-scale-convention.md for the full convention.`,
    );
    process.exit(1);
  }

  console.log(
    `check:font-scale OK — no bare numeric fontSize: values found.\n` +
    `  scanned root : ${SCAN_ROOT}\n` +
    `  files checked: ${totalFiles}`,
  );
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
