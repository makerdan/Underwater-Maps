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

import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Documented exceptions — must be kept in sync with security-audit-exceptions.md
// ---------------------------------------------------------------------------
const EXCEPTIONS = {
  "GHSA-hmw2-7cc7-3qxx": {
    reason:
      "form-data CRLF injection — only reachable via @types/supertest (dev-only type declarations) " +
      "and @google-cloud/storage transitive type dep. Not exploitable at runtime.",
    fixDate: "2026-10-17",
  },
  "GHSA-22p9-wv53-3rq4": {
    reason:
      "linkify-it quadratic scan — only reachable via orval>typedoc at build time, " +
      "never in a deployed service. No user input reaches this code path at runtime.",
    fixDate: "2026-10-17",
  },
  "GHSA-fx2h-pf6j-xcff": {
    reason:
      "vite server.fs.deny bypass — Windows-only attack vector; this project runs on Linux. " +
      "Fix already committed: pnpm-workspace.yaml overrides forces vite>=7.3.5. " +
      "This finding disappears once pnpm install is re-run and the lockfile is updated. " +
      "Remove this exception after the next successful pnpm install.",
    fixDate: "2026-08-01",
  },
  // undici via jsdom — test-only devDep, not deployed to production.
  // Cannot override undici to >=7.28.0: jsdom 29.1.1 hard-requires internal
  // paths (e.g. undici/lib/handler/wrap-handler.js) that were removed in
  // undici 7.28.0, breaking all Vitest/jsdom tests if the override is applied.
  // None of the vulnerable paths (SOCKS5 proxy, WebSocket client) are reachable
  // through jsdom's use of undici in test environments.
  "GHSA-vmh5-mc38-953g": {
    reason:
      "undici TLS bypass via SOCKS5 ProxyAgent — only reachable via jsdom (test devDep). " +
      "SOCKS5 proxy is never used in tests. Cannot upgrade: jsdom 29.1.1 requires undici " +
      "<7.28.0 internal paths. Fix: upgrade jsdom when a version shipping undici>=7.28.0 is released.",
    fixDate: "2026-10-17",
  },
  "GHSA-vxpw-j846-p89q": {
    reason:
      "undici WebSocket DoS via fragment count — only reachable via jsdom (test devDep). " +
      "WebSocket client is never used in tests. Cannot upgrade: jsdom 29.1.1 requires undici " +
      "<7.28.0 internal paths. Fix: upgrade jsdom when a version shipping undici>=7.28.0 is released.",
    fixDate: "2026-10-17",
  },
  "GHSA-hm92-r4w5-c3mj": {
    reason:
      "undici cross-origin routing via SOCKS5 proxy pool reuse — only reachable via jsdom (test devDep). " +
      "SOCKS5 proxy is never used in tests. Cannot upgrade: jsdom 29.1.1 requires undici " +
      "<7.28.0 internal paths. Fix: upgrade jsdom when a version shipping undici>=7.28.0 is released.",
    fixDate: "2026-10-17",
  },
};

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
// Filter findings
// ---------------------------------------------------------------------------
const advisories = Object.values(report.advisories ?? {});
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
