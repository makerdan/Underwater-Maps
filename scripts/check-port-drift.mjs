#!/usr/bin/env node
/**
 * check-port-drift.mjs — Config/port drift check.
 *
 * Guards against two classes of drift:
 *
 * 1. HARDCODED-PORT DRIFT — every artifact entry point (Vite configs, the API
 *    server bootstrap) must derive its listen port from the PORT env var and
 *    fail fast when it is absent. A hardcoded `port: 1234` or a silent
 *    fallback like `process.env.PORT ?? 3000` bypasses the platform's
 *    per-artifact port assignment and causes collisions in the workspace.
 *
 * 2. PORT-COLLISION DRIFT — statically declared ports (currently the
 *    Playwright webServer commands) must be unique per service and internally
 *    consistent: every URL referencing a port in the same file must match a
 *    declared PORT=NNNN assignment.
 *
 * When this check fails it names the offending file/line and tells you
 * whether to remove a hardcoded port or fix a collision.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

// ── 1. PORT-env enforcement in artifact entry points ────────────────────────
const entryPoints = [
  "artifacts/bathyscan/vite.config.ts",
  "artifacts/mockup-sandbox/vite.config.ts",
  "artifacts/api-server/src/index.ts",
];

for (const rel of entryPoints) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    errors.push(`${rel}: file not found — update entryPoints in scripts/check-port-drift.mjs if it moved.`);
    continue;
  }
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");

  if (!/process\.env(\[.PORT.\]|\.PORT)/.test(src)) {
    errors.push(`${rel}: does not read process.env.PORT — every artifact must derive its port from the PORT env var.`);
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    // Hardcoded numeric port in a server/listen config, e.g. `port: 3000`
    const hard = line.match(/\bport\s*:\s*(\d{2,5})\b/);
    if (hard) {
      errors.push(`${rel}:${i + 1}: hardcoded port ${hard[1]} — use the PORT env var instead (\`port: Number(process.env.PORT)\`).`);
    }
    // Silent numeric fallback, e.g. `process.env.PORT ?? 3000` or `|| 3000`
    const fallback = line.match(/PORT[^\n]*(\?\?|\|\|)\s*['"`]?(\d{2,5})\b/);
    if (fallback) {
      errors.push(`${rel}:${i + 1}: silent fallback to port ${fallback[2]} — PORT must be required (throw when absent), not defaulted.`);
    }
  });
}

// ── 2. Static port declarations: uniqueness + URL consistency ───────────────
const staticConfigs = ["playwright.config.ts"];

for (const rel of staticConfigs) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) continue;
  const src = readFileSync(abs, "utf8");
  const lines = src.split("\n");

  // PORT=NNNN assignments (one per webServer command = one service)
  const declared = new Map(); // port -> [lineNo, ...]
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bPORT=(\d{2,5})\b/g)) {
      const p = m[1];
      if (!declared.has(p)) declared.set(p, []);
      declared.get(p).push(i + 1);
    }
  });

  for (const [port, at] of declared) {
    if (at.length > 1) {
      errors.push(`${rel}: port ${port} is assigned to more than one service (lines ${at.join(", ")}) — each webServer needs a unique port.`);
    }
  }

  // Every localhost/127.0.0.1 URL port must correspond to a declared PORT=
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g)) {
      if (!declared.has(m[1])) {
        errors.push(`${rel}:${i + 1}: URL references port ${m[1]} but no \`PORT=${m[1]}\` assignment exists in this file — update the URL or the webServer command so they match.`);
      }
    }
  });
}

if (errors.length > 0) {
  console.error("ERROR: Port/config drift detected:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("");
  console.error("Ports must come from the PORT env var in artifact entry points, and");
  console.error("statically declared ports (Playwright webServers) must be unique and");
  console.error("consistent with the URLs that reference them.");
  process.exit(1);
}

console.log("check:port-drift — no hardcoded ports, collisions, or PORT-env bypasses found.");
