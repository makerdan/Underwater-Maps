#!/usr/bin/env node
/**
 * Root-relative /api/ fetch guard.
 *
 * Scans `artifacts/bathyscan/src` for any `fetch(` or `authorizedFetch(` calls
 * that use a root-relative `/api/` path (e.g. fetch("/api/settings")).
 * These calls break when the app is served from a sub-path because they escape
 * the artifact's base-path prefix.  All API calls must use `${API_BASE}api/…`
 * instead.
 *
 * Exclusions:
 *   - Test files: any file under a `__tests__` directory, or files whose name
 *     contains `.test.` or `.spec.`
 *   - Service workers: `sw.ts` / `sw.js` (they run at the root scope by design)
 *   - This script itself (its own regex literals would self-match)
 *
 * Usage:
 *   node scripts/check-root-relative-api.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_ROOT = path.join(repoRoot, "artifacts/bathyscan/src");

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", "__mocks__",
]);

function isTestFile(relPath) {
  const parts = relPath.split("/");
  if (parts.includes("__tests__")) return true;
  const basename = parts[parts.length - 1];
  return (
    basename.includes(".test.") ||
    basename.includes(".spec.") ||
    basename === "sw.ts" ||
    basename === "sw.js"
  );
}

function* walk(entry) {
  const stat = fs.statSync(entry, { throwIfNoEntry: false });
  if (!stat) return;
  if (stat.isFile()) {
    if (SCAN_EXTENSIONS.has(path.extname(entry))) yield entry;
    return;
  }
  if (!stat.isDirectory()) return;
  for (const name of fs.readdirSync(entry)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(path.join(entry, name));
  }
}

function relToRepo(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

// Match fetch( or authorizedFetch( immediately followed by a quote+"/api/"
// The quote may be ", ', or ` (template literal).
const ROOT_RELATIVE_API_RE = /\b(?:authorizedFetch|fetch)\(\s*["'`]\/api\//;

// Lines whose first non-whitespace token is a line-comment (//) or the start
// of a block-comment (/*) are skipped — commented-out code is not a violation.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

const violations = [];

for (const file of walk(SCAN_ROOT)) {
  const rel = relToRepo(file);
  if (isTestFile(rel)) continue;

  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (COMMENT_LINE_RE.test(line)) return;
    if (ROOT_RELATIVE_API_RE.test(line)) {
      violations.push({ file: rel, line: idx + 1, text: line.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error(
    "root-relative-api-guard: root-relative /api/ fetch calls found:\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`      ${v.text}`);
  }
  console.error(
    `\n${violations.length} violation(s). Use \`\${API_BASE}api/…\` instead of ` +
      `"/api/…" so calls work when the app is served from a sub-path.\n` +
      `See artifacts/bathyscan/src/lib/apiBase.ts for the API_BASE export.`,
  );
  process.exit(1);
}

console.log("root-relative-api-guard: OK — no root-relative /api/ fetch calls found.");
