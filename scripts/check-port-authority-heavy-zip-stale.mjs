#!/usr/bin/env node
/**
 * check-port-authority-heavy-zip-stale.mjs — Drift guard between
 * artifacts/bathyscan/public/port-authority-heavy-skill.zip and
 * .agents/skills/Port-Authority-Heavy/SKILL.md.
 *
 * The zip is a downloadable snapshot of the skill published from the BathyScan
 * web app. Whenever the skill changes the zip must be regenerated; this check
 * catches stale zips before they reach production.
 *
 * Exits 0 (skip) if the zip does not yet exist — the check is a no-op until a
 * downloadable copy is published for the first time.
 * Exits 0 if the zip contains the exact current SKILL.md content.
 * Exits 1 with a remediation hint if the zip exists but is stale.
 *
 * Usage:
 *   node scripts/check-port-authority-heavy-zip-stale.mjs
 *   pnpm run check:port-authority-heavy-zip
 *
 * To regenerate the zip manually:
 *   (cd .agents/skills && zip ../../artifacts/bathyscan/public/port-authority-heavy-skill.zip Port-Authority-Heavy/SKILL.md)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SKILL_PATH = resolve(root, ".agents/skills/Port-Authority-Heavy/SKILL.md");
const ZIP_TARGETS = [
  {
    path: resolve(root, "artifacts/bathyscan/public/port-authority-heavy-skill.zip"),
    entry: "Port-Authority-Heavy/SKILL.md",
  },
  {
    path: resolve(root, "exports/port-authority-skills.zip"),
    entry: "Port-Authority-Heavy/SKILL.md",
  },
  {
    path: resolve(root, "port-authority-skills.zip"),
    entry: ".agents/skills/Port-Authority-Heavy/SKILL.md",
  },
];

const REGEN_HINT =
  "  Regenerate the published Port Authority zip assets from .agents/skills.";

// ---------------------------------------------------------------------------
// Existence checks
// ---------------------------------------------------------------------------

if (!existsSync(SKILL_PATH)) {
  console.error(
    `[check-port-authority-heavy-zip-stale] ERROR: skill source not found: ${SKILL_PATH}`,
  );
  console.error("  Ensure .agents/skills/Port-Authority-Heavy/SKILL.md exists.");
  process.exit(1);
}

const existingTargets = ZIP_TARGETS.filter(({ path }) => existsSync(path));
if (existingTargets.length === 0) {
  // No zip published yet — nothing to validate. This is the expected state
  // until a downloadable copy is intentionally published under
  // artifacts/bathyscan/public/port-authority-heavy-skill.zip.
  console.log(
    "[check-port-authority-heavy-zip-stale] SKIP — port-authority-heavy-skill.zip not yet published; nothing to validate",
  );
  process.exit(0);
}

const onDisk = readFileSync(SKILL_PATH);
for (const { path: zipPath, entry } of existingTargets) {
  const result = spawnSync("unzip", ["-p", zipPath, entry], { encoding: "buffer" });
  if (result.status !== 0) {
    console.error(
      `[check-port-authority-heavy-zip-stale] FAIL: could not extract '${entry}' from ${zipPath}`,
    );
    const stderr = result.stderr?.toString("utf8").trim();
    if (stderr) console.error(`  unzip error: ${stderr}`);
    console.error(REGEN_HINT);
    process.exit(1);
  }
  if (!result.stdout.equals(onDisk)) {
    console.error(`[check-port-authority-heavy-zip-stale] FAIL: ${zipPath} is stale`);
    console.error(
      `  The zip entry '${entry}' does not match .agents/skills/Port-Authority-Heavy/SKILL.md.`,
    );
    console.error(REGEN_HINT);
    process.exit(1);
  }
}

console.log(
  `[check-port-authority-heavy-zip-stale] OK — ${existingTargets.length} published zip asset(s) are up to date`,
);
