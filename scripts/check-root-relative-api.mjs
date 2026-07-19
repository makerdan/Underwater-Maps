#!/usr/bin/env node
/**
 * Root-relative /api/ fetch guard.
 *
 * Scans `artifacts/bathyscan/src` for any registered fetch-wrapper calls that
 * use a root-relative `/api/` path (e.g. fetch("/api/settings")).
 * These calls break when the app is served from a sub-path because they escape
 * the artifact's base-path prefix.  All API calls must use `${API_BASE}api/…`
 * instead.
 *
 * ─── Adding a new fetch wrapper ───────────────────────────────────────────────
 * When you introduce a new helper that accepts a URL as its first argument and
 * issues requests to the BathyScan API (e.g. `myApiFetch(url, opts)`), add its
 * name to the FETCH_WRAPPERS array below.  The guard will then automatically
 * flag any call-site that passes a root-relative `/api/` URL to that helper.
 *
 * Do NOT add wrappers that call external third-party URLs (ERDDAP, NOAA, GCS,
 * etc.) — those legitimately use absolute URLs and are out of scope.
 *
 * Example:
 *   // Before: only fetch + authorizedFetch checked
 *   // After adding "myApiFetch":
 *   const FETCH_WRAPPERS = [
 *     "fetch",
 *     "authorizedFetch",
 *     "fetchJsonWithProgress",
 *     "myApiFetch",          // <-- add here
 *   ];
 * ──────────────────────────────────────────────────────────────────────────────
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

/**
 * Central registry of fetch wrappers that accept a URL as their first
 * argument and route requests to the BathyScan API.
 *
 * Rules:
 *  - Each entry is the bare function name (no parentheses).
 *  - Order does not matter.
 *  - Do NOT include wrappers that call external/third-party URLs.
 *  - See the "Adding a new fetch wrapper" section in the file header above
 *    for step-by-step instructions.
 */
const FETCH_WRAPPERS = [
  "fetch",                 // native browser fetch
  "authorizedFetch",       // artifacts/bathyscan/src/lib/authorizedFetch.ts
  "fetchJsonWithProgress", // artifacts/bathyscan/src/lib/fetchWithProgress.ts
];

// Build a single regex from the registry.
// Matches: <wrapperName>( immediately followed by a quote + "/api/"
// The quote may be ", ', or ` (template literal).
const wrapperPattern = FETCH_WRAPPERS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const ROOT_RELATIVE_API_RE = new RegExp(`\\b(?:${wrapperPattern})\\(\\s*["'\`]\\/api\\/`);

// Lines whose first non-whitespace token is a line-comment (//) or the start
// of a block-comment (/*) are skipped — commented-out code is not a violation.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

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
      `See artifacts/bathyscan/src/lib/authorizedFetch.ts and fetchWithProgress.ts.\n` +
      `To register a new fetch wrapper, add its name to FETCH_WRAPPERS in this script.`,
  );
  process.exit(1);
}

console.log(
  `root-relative-api-guard: OK — no root-relative /api/ fetch calls found.` +
  ` (checked ${FETCH_WRAPPERS.length} wrapper(s): ${FETCH_WRAPPERS.join(", ")})`,
);
