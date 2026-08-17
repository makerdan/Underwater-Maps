#!/usr/bin/env node
/**
 * Security audit gate — fails on any high or critical advisory that is NOT
 * a documented exception listed below.
 *
 * Run:  node scripts/check-audit.mjs
 *       pnpm check:audit
 *
 * To add a new exception: add an entry to EXCEPTIONS with the GHSA ID,
 * the reason the advisory is acceptable, and a planned-fix date.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Documented exceptions — must be kept in sync with security-audit-exceptions.md
//
// When adding or extending an exception, set a realistic `fixDate` — the
// script warns on every run once that date has passed, so a stale date
// creates noise and an overly generous one hides overdue work.
// ---------------------------------------------------------------------------
const EXCEPTIONS = {
  "GHSA-22p9-wv53-3rq4": {
    reason:
      "linkify-it quadratic scan — only reachable via orval>typedoc at build time, " +
      "never in a deployed service. No user input reaches this code path at runtime.",
    fixDate: "2026-10-17",
  },
};

// ---------------------------------------------------------------------------
// Warn on overdue exception fix-dates (runs even on a clean audit so overdue
// entries stay visible in CI output without reading the source).
// ---------------------------------------------------------------------------
const now = new Date();
for (const [ghsa, ex] of Object.entries(EXCEPTIONS)) {
  const fixDate = new Date(ex.fixDate);
  if (!Number.isNaN(fixDate.getTime()) && fixDate < now) {
    console.warn(
      `check:audit — WARNING: exception ${ghsa} is past its planned fix date ` +
        `(${ex.fixDate}). Reason: ${ex.reason}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Run audit
// ---------------------------------------------------------------------------
let raw;
try {
  raw = execSync("pnpm audit --json --audit-level=high", {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
} catch (err) {
  // pnpm audit exits with a non-zero code when vulnerabilities are found —
  // capture stdout from the error object.
  raw = err.stdout ? err.stdout.toString() : "";
}

if (!raw.trim()) {
  console.log("check:audit — no output from pnpm audit; assuming clean.");
  process.exit(0);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error("check:audit — failed to parse pnpm audit JSON output:");
  console.error(raw);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate report shape
// ---------------------------------------------------------------------------
if (
  typeof report.advisories !== "object" ||
  report.advisories === null ||
  Array.isArray(report.advisories)
) {
  console.error(
    "check:audit — pnpm audit JSON format changed — report.advisories not found. Update check-audit.mjs.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Filter findings
// ---------------------------------------------------------------------------
const advisories = Object.values(report.advisories);
const blocking = [];
const exempted = [];

for (const adv of advisories) {
  const severity = adv.severity;
  if (severity !== "high" && severity !== "critical") continue;

  const ghsa = (adv.url ?? "").replace("https://github.com/advisories/", "");
  if (EXCEPTIONS[ghsa]) {
    exempted.push({ ghsa, severity, title: adv.title });
  } else {
    blocking.push({ ghsa, severity, title: adv.title, via: adv.via });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (exempted.length > 0) {
  console.log(`\ncheck:audit — ${exempted.length} exempted finding(s) (see security-audit-exceptions.md):`);
  for (const e of exempted) {
    const ex = EXCEPTIONS[e.ghsa];
    console.log(`  [${e.severity.toUpperCase()}] ${e.ghsa} — ${e.title}`);
    console.log(`         Reason: ${ex.reason}`);
    console.log(`         Fix by: ${ex.fixDate}`);
  }
}

if (blocking.length > 0) {
  console.error(`\ncheck:audit — ${blocking.length} unexempted high/critical finding(s):`);
  for (const b of blocking) {
    console.error(`  [${b.severity.toUpperCase()}] ${b.ghsa} — ${b.title}`);
  }
  console.error(
    "\nTo fix: update the affected package to a patched version, OR add a documented " +
      "exception to EXCEPTIONS in scripts/check-audit.mjs + security-audit-exceptions.md.",
  );
  process.exit(1);
}

console.log("\ncheck:audit — no unexempted high or critical vulnerabilities found. ✓");
process.exit(0);
