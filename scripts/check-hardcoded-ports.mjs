#!/usr/bin/env node
/**
 * Hardcoded-port guard.
 *
 * Scans source, config, and package.json files for hardcoded port bindings
 * and PORT fallback patterns. Every service must source its port exclusively
 * from the PORT environment variable, and the deliberately fixed E2E ports
 * must live only in the allowlisted registry (tests/e2e/ports.ts).
 *
 * Deliberately does NOT flag lookalike numbers such as timeouts (3000,
 * 30000) or test data — every pattern requires explicit port context
 * (listen call, `port:` config key, PORT env fallback, PORT= assignment,
 * or a localhost/127.0.0.1 URL inside the E2E tree).
 *
 * Usage:
 *   node scripts/check-hardcoded-ports.mjs            # scan the repo
 *   node scripts/check-hardcoded-ports.mjs --scan DIR # scan DIR only (tests)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Configuration ───────────────────────────────────────────────────────────

// The single allowlisted registry of fixed E2E ports (repo-relative).
const ALLOWLIST = new Set(["tests/e2e/ports.ts"]);

// Default scan roots (repo-relative). Everything a process could bind a
// port from: artifact sources + configs, shared libs, test code, scripts.
const DEFAULT_ROOTS = [
  "artifacts",
  "lib",
  "tests",
  "scripts",
  "playwright.config.ts",
  "package.json",
];

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sh",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "dist-e2e", "dist-porttest", "build",
  "coverage", "test-results", "generated", "public", "attached_assets",
]);

// Patterns that indicate a hardcoded port. Each requires port *context* so
// bare numbers (timeouts, test data) never match.
const PATTERNS = [
  {
    name: "shell PORT fallback (dollar-brace PORT:-N)",
    re: /\$\{PORT:-\d+\}/,
  },
  {
    name: "JS PORT fallback (env PORT with ??, ??= or || default)",
    re: /\bPORT\b["'\]]*\s*(\?\?=?|\|\|)\s*["'`]?\d{2,5}\b/,
  },
  {
    name: "hardcoded listen() port",
    re: /\.listen\(\s*["'`]?\d{2,5}\b/,
  },
  {
    name: "hardcoded `port:` in server config",
    re: /\bport\s*:\s*["'`]?\d{4,5}\b/i,
  },
  {
    name: "inline PORT= assignment in a command",
    re: /\bPORT=\d{2,5}\b/,
  },
  {
    name: "hardcoded localhost URL port in E2E code",
    re: /\b(?:localhost|127\.0\.0\.1):\d{4,5}\b/,
    // Only enforced where the central port registry must be used instead.
    onlyUnder: ["tests/e2e", "playwright.config.ts"],
  },
];

// ── Scan ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const scanRoots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scan") {
    const dir = args[++i];
    if (!dir) {
      console.error("--scan requires a path argument");
      process.exit(2);
    }
    scanRoots.push(path.resolve(dir));
  }
}
const usingCustomRoots = scanRoots.length > 0;
const roots = usingCustomRoots
  ? scanRoots
  : DEFAULT_ROOTS.map((r) => path.join(repoRoot, r));

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

for (const root of roots) {
  for (const file of walk(root)) {
    const rel = relToRepo(file);
    if (!usingCustomRoots && ALLOWLIST.has(rel)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      for (const pattern of PATTERNS) {
        if (
          !usingCustomRoots &&
          pattern.onlyUnder &&
          !pattern.onlyUnder.some((p) => rel === p || rel.startsWith(`${p}/`))
        ) {
          continue;
        }
        if (pattern.re.test(line)) {
          violations.push({ file: rel, line: idx + 1, pattern: pattern.name, text: line.trim() });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("Hardcoded port violations found:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]`);
    console.error(`      ${v.text}`);
  }
  console.error(
    `\n${violations.length} violation(s). Ports must come exclusively from the ` +
      `PORT environment variable; fixed E2E ports belong in tests/e2e/ports.ts.`,
  );
  process.exit(1);
}

console.log("ports-guard: OK — no hardcoded ports found.");
