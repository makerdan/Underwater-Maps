#!/usr/bin/env node
/**
 * Root-relative /api/ fetch guard.
 *
 * Runs two phases:
 *
 * ── Phase 1: root-relative call-site scan ─────────────────────────────────
 * Scans one or more source trees for any registered fetch-wrapper calls that
 * use a root-relative `/api/` path (e.g. fetch("/api/settings")).
 * These calls break when the app is served from a sub-path because they escape
 * the artifact's base-path prefix.  All API calls must use `${API_BASE}api/…`
 * instead.
 *
 * ── Phase 2: unregistered fetch-wrapper definition scan ───────────────────
 * Scans the api-server source for exported functions that:
 *   (a) accept a URL as their first argument (named url, href, endpoint, etc.)
 *   (b) call native fetch() inside their body
 * Any such function that is not listed in FETCH_WRAPPERS (can receive internal
 * /api/ paths) or KNOWN_EXTERNAL_WRAPPERS (only ever calls external services)
 * causes this guard to fail with instructions on how to classify it.
 *
 * This prevents silent gaps where a new api-server fetch helper is added but
 * never registered, allowing a future root-relative call to slip through.
 *
 * ─── Scan roots ───────────────────────────────────────────────────────────
 * SCAN_ROOTS lists every source tree that should be checked by Phase 1.  Each
 * entry is a path relative to the repo root.  Add a new entry whenever a new
 * artifact gains helpers that call the BathyScan API.
 *
 * External-URL wrappers (ERDDAP, NOAA, GCS, Poe, …) are out of scope: they
 * always receive absolute https://… URLs so the root-relative pattern never
 * matches them.  Do NOT add those wrappers to FETCH_WRAPPERS.
 *
 * ─── Adding a new internal fetch wrapper ──────────────────────────────────
 * When you introduce a new helper that accepts a URL as its first argument and
 * issues requests to the BathyScan API (e.g. `myApiFetch(url, opts)`):
 *   1. Add its name to FETCH_WRAPPERS below.
 *   2. Phase 1 will then flag any call-site that passes a root-relative
 *      `/api/` URL to that helper.
 *
 * ─── Adding a new external-only fetch wrapper ─────────────────────────────
 * If your new helper only ever calls external services (ERDDAP, NOAA, GCS,
 * etc.) and accepts a URL-like first argument, add it to KNOWN_EXTERNAL_WRAPPERS
 * instead so Phase 2 does not flag it as unclassified.
 *
 * Example:
 *   export async function fetchMyService(url: string) { … fetch(url) … }
 *   → if internal BathyScan routes: add "fetchMyService" to FETCH_WRAPPERS
 *   → if external-only:             add "fetchMyService" to KNOWN_EXTERNAL_WRAPPERS
 *
 * ──────────────────────────────────────────────────────────────────────────
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

/**
 * Source trees to scan (Phase 1).  Paths are relative to the repo root.
 *
 * ─── Adding a new scan root ───────────────────────────────────────────────
 * Append the relative path to the array below.  The scan will automatically
 * pick up all .ts/.tsx/.js/.jsx/.mjs files (excluding test files, dist, etc.).
 *
 * NOTE: Only add trees that make internal calls to the BathyScan /api/ routes.
 *       Do NOT add trees whose fetch calls are exclusively to external services.
 * ──────────────────────────────────────────────────────────────────────────
 */
const SCAN_ROOTS = [
  "artifacts/bathyscan/src",
  "artifacts/api-server/src",
];

/**
 * Source tree to scan for unregistered fetch wrapper definitions (Phase 2).
 * Limited to api-server/src: bathyscan wrappers are already manually registered
 * in FETCH_WRAPPERS above (authorizedFetch, fetchJsonWithProgress).
 */
const WRAPPER_DEF_SCAN_ROOT = "artifacts/api-server/src";

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
 *  - See the "Adding a new internal fetch wrapper" section above for details.
 */
const FETCH_WRAPPERS = [
  "fetch",                 // native fetch (used in both bathyscan and api-server)
  "authorizedFetch",       // artifacts/bathyscan/src/lib/authorizedFetch.ts
  "fetchJsonWithProgress", // artifacts/bathyscan/src/lib/fetchWithProgress.ts
];

/**
 * Exported api-server functions that call native fetch() internally but only
 * ever issue requests to external services (ERDDAP, NOAA, GCS, Copernicus, …).
 * These are classified as external-only so Phase 2 does not flag them as
 * unregistered.
 *
 * ─── Classifying a new external-only wrapper ──────────────────────────────
 * If your new exported helper:
 *   • accepts a URL-like first argument (url, href, endpoint, uri, …)
 *   • calls fetch() in its body
 *   • only ever issues requests to external services (never /api/…)
 * add its name here.  If it can receive BathyScan-internal /api/ paths,
 * add it to FETCH_WRAPPERS instead.
 * ──────────────────────────────────────────────────────────────────────────
 */
const KNOWN_EXTERNAL_WRAPPERS = new Set([
  // Add external-only helpers here as they are introduced.
  // (Existing api-server fetch helpers use domain-specific first params —
  //  bbox, stationId, lat/lon, etc. — not a raw URL, so they are not
  //  detected by the URL-param heuristic and need no entry here.)
]);

// ── Phase 1 helpers ────────────────────────────────────────────────────────

// Build a single regex from the registry.
// Matches: <wrapperName>( immediately followed by a quote + "/api/"
// The quote may be ", ', or ` (template literal).
const wrapperPattern = FETCH_WRAPPERS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const ROOT_RELATIVE_API_RE = new RegExp(`\\b(?:${wrapperPattern})\\(\\s*["'\`]\\/api\\/`);

// Lines whose first non-whitespace token is a line-comment (//) or the start
// of a block-comment (/*) are skipped — commented-out code is not a violation.
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

// ── Phase 2 helpers ────────────────────────────────────────────────────────

/**
 * First-parameter names that indicate a function accepts a raw URL.
 * Matched case-insensitively against the first positional parameter name.
 */
const URL_PARAM_NAMES = new Set([
  "url", "href", "endpoint", "uri",
  "apiurl", "requesturl", "targeturl", "apipath",
]);

/**
 * Patterns that match the start of an exported function definition.
 * Group 1 captures the exported name in each case.
 *
 * Covers:
 *   export [async] function name(
 *   export const name = [async] (        ← arrow function
 *   export const name = [async] function ← named function expression
 */
const EXPORT_FN_RE = /\bexport\s+(?:(?:async\s+)?function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\())/g;

/**
 * Matches a bare fetch() call — NOT a method call like obj.fetch() or
 * a property access like source.fetch.
 */
const BARE_FETCH_CALL_RE = /(?<![.\w])fetch\s*\(/;

/**
 * Extract the first positional parameter name from a function signature
 * substring (the text immediately following the opening parenthesis of the
 * parameter list).
 */
function firstParamName(src, openParenIdx) {
  const after = src.slice(openParenIdx + 1, openParenIdx + 120);
  const m = after.match(/^\s*([a-zA-Z_$]\w*)/);
  return m ? m[1].toLowerCase() : "";
}

/**
 * Given source text and a position to begin searching, locate the opening `{`
 * for a function body and extract the complete body (opening brace to matching
 * closing brace) using brace-counting.
 *
 * Returns null if no body is found (e.g. for interface method signatures).
 *
 * Note: brace-counting is a heuristic — string literals and template literals
 * containing `{`/`}` can skew the count.  For this guard's purposes
 * (detecting fetch() within a function body) false-positives are manageable
 * and false-negatives are the greater risk.
 */
function extractBody(src, searchFrom) {
  const openBrace = src.indexOf("{", searchFrom);
  if (openBrace === -1) return null;
  // If a `;` (interface/type member terminator) appears before the `{`, this
  // is a type declaration, not a function body.
  const semi = src.indexOf(";", searchFrom);
  if (semi !== -1 && semi < openBrace) return null;
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openBrace, i + 1);
    }
  }
  return null;
}

/**
 * Scan `src` for exported function definitions that:
 *   (a) accept a URL-like value as their first positional parameter
 *   (b) call native fetch() somewhere in their body
 *
 * Returns a Set of function names matching both criteria.
 */
function detectFetchWrappersInSource(src) {
  const found = new Set();
  EXPORT_FN_RE.lastIndex = 0;
  let m;
  while ((m = EXPORT_FN_RE.exec(src)) !== null) {
    const name = m[1] ?? m[2];
    if (!name) continue;

    // Locate the opening `(` of the parameter list after the match.
    const afterMatch = m.index + m[0].length;
    const parenIdx = src.indexOf("(", afterMatch - 1);
    if (parenIdx === -1) continue;

    // Check first parameter name.
    const param = firstParamName(src, parenIdx);
    if (!URL_PARAM_NAMES.has(param)) continue;

    // Extract the function body and check for a bare fetch() call.
    const body = extractBody(src, afterMatch);
    if (body && BARE_FETCH_CALL_RE.test(body)) {
      found.add(name);
    }
  }
  return found;
}

// ── Shared utilities ───────────────────────────────────────────────────────

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

// ── Phase 1: root-relative call-site scan ─────────────────────────────────

const violations = [];
let totalFiles = 0;

for (const scanRoot of SCAN_ROOTS) {
  const absRoot = path.join(repoRoot, scanRoot);
  for (const file of walk(absRoot)) {
    const rel = relToRepo(file);
    if (isTestFile(rel)) continue;
    totalFiles++;

    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (COMMENT_LINE_RE.test(line)) return;
      if (ROOT_RELATIVE_API_RE.test(line)) {
        violations.push({ file: rel, line: idx + 1, text: line.trim() });
      }
    });
  }
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
      `To register a new fetch wrapper, add its name to FETCH_WRAPPERS in this script.\n` +
      `To add a new scan root, add the path to SCAN_ROOTS in this script.`,
  );
  process.exit(1);
}

// ── Phase 2: unregistered fetch-wrapper definition scan ───────────────────

const allRegistered = new Set([...FETCH_WRAPPERS, ...KNOWN_EXTERNAL_WRAPPERS]);
/** @type {Array<{file: string, name: string}>} */
const unregisteredWrappers = [];

const wrapperDefAbsRoot = path.join(repoRoot, WRAPPER_DEF_SCAN_ROOT);
for (const file of walk(wrapperDefAbsRoot)) {
  const rel = relToRepo(file);
  if (isTestFile(rel)) continue;

  const src = fs.readFileSync(file, "utf8");
  const detected = detectFetchWrappersInSource(src);
  for (const name of detected) {
    if (!allRegistered.has(name)) {
      unregisteredWrappers.push({ file: rel, name });
    }
  }
}

if (unregisteredWrappers.length > 0) {
  console.error(
    "root-relative-api-guard: unregistered fetch wrapper definition(s) detected:\n",
  );
  for (const w of unregisteredWrappers) {
    console.error(`  ${w.name}  (${w.file})`);
  }
  console.error(`
${unregisteredWrappers.length} unregistered wrapper(s).

Each exported api-server function that accepts a URL-like first argument and
calls fetch() internally must be classified in scripts/check-root-relative-api.mjs:

  • If it can receive a BathyScan-internal /api/ URL:
      → Add its name to FETCH_WRAPPERS
        (Phase 1 will then flag any root-relative /api/ call-site.)

  • If it only ever calls external services (ERDDAP, NOAA, GCS, …):
      → Add its name to KNOWN_EXTERNAL_WRAPPERS

Leaving a wrapper unclassified means a future root-relative /api/ call through
it will not be caught by this guard.`);
  process.exit(1);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(
  `root-relative-api-guard: OK — no root-relative /api/ fetch calls found.\n` +
  `  scanned roots     : ${SCAN_ROOTS.join(", ")}\n` +
  `  fetch wrappers    : ${FETCH_WRAPPERS.join(", ")}\n` +
  `  files checked     : ${totalFiles}\n` +
  `  wrapper def scan  : ${WRAPPER_DEF_SCAN_ROOT} (unregistered wrappers: 0)`,
);
