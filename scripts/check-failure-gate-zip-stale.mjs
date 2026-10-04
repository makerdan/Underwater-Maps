#!/usr/bin/env node
/**
 * check-failure-gate-zip-stale.mjs — Drift guard between
 * artifacts/bathyscan/public/failure-gate-skill.zip and
 * .agents/skills/failure-gate-v4/SKILL.md.
 *
 * The zip is a downloadable snapshot of the skill published from the BathyScan
 * web app. Whenever the skill changes the zip must be regenerated; this check
 * catches stale zips before they reach production.
 *
 * Exits 0 if the zip contains the exact current SKILL.md content.
 * Exits 1 with a remediation hint if the zip is stale or missing.
 *
 * Usage:
 *   node scripts/check-failure-gate-zip-stale.mjs
 *   pnpm run check:failure-gate-zip
 *
 * To regenerate the zip manually:
 *   rm -f artifacts/bathyscan/public/failure-gate-skill.zip
 *   (cd .agents/skills && zip ../../artifacts/bathyscan/public/failure-gate-skill.zip failure-gate-v4/SKILL.md)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SKILL_PATH = resolve(root, ".agents/skills/failure-gate-v4/SKILL.md");
const ZIP_PATH = resolve(root, "artifacts/bathyscan/public/failure-gate-skill.zip");
const ZIP_ENTRY = "failure-gate-v4/SKILL.md";

const REGEN_HINT =
  "  Regenerate: rm -f artifacts/bathyscan/public/failure-gate-skill.zip && (cd .agents/skills && zip ../../artifacts/bathyscan/public/failure-gate-skill.zip failure-gate-v4/SKILL.md)";

// ---------------------------------------------------------------------------
// Existence checks
// ---------------------------------------------------------------------------

if (!existsSync(SKILL_PATH)) {
  console.error(
    `[check-failure-gate-zip-stale] ERROR: skill source not found: ${SKILL_PATH}`,
  );
  console.error("  Ensure .agents/skills/failure-gate-v4/SKILL.md exists.");
  process.exit(1);
}

if (!existsSync(ZIP_PATH)) {
  console.error(
    `[check-failure-gate-zip-stale] FAIL: zip not found: ${ZIP_PATH}`,
  );
  console.error(REGEN_HINT);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extract the entry from the zip and compare
// ---------------------------------------------------------------------------

// unzip -p writes entry contents to stdout — no on-disk temp directory is needed.
const listing = spawnSync(
  "unzip",
  ["-Z1", ZIP_PATH],
  { encoding: "utf8" },
);
if (listing.status !== 0) {
  console.error(
    `[check-failure-gate-zip-stale] FAIL: could not list ${ZIP_PATH}`,
  );
  const stderr = listing.stderr?.trim();
  if (stderr) console.error(`  unzip error: ${stderr}`);
  console.error(REGEN_HINT);
  process.exit(1);
}

const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
if (entries.length !== 1 || entries[0] !== ZIP_ENTRY) {
  console.error(
    "[check-failure-gate-zip-stale] FAIL: archive must contain only the canonical v4 skill",
  );
  console.error(
    `  Expected '${ZIP_ENTRY}'; found ${entries.length > 0 ? entries.join(", ") : "(no entries)"}.`,
  );
  console.error(REGEN_HINT);
  process.exit(1);
}

const result = spawnSync(
  "unzip",
  ["-p", ZIP_PATH, ZIP_ENTRY],
  { encoding: "buffer" },
);

if (result.status !== 0) {
  console.error(
    `[check-failure-gate-zip-stale] FAIL: could not extract '${ZIP_ENTRY}' from ${ZIP_PATH}`,
  );
  const stderr = result.stderr?.toString("utf8").trim();
  if (stderr) console.error(`  unzip error: ${stderr}`);
  console.error(REGEN_HINT);
  process.exit(1);
}

const inZip = result.stdout;
const onDisk = readFileSync(SKILL_PATH);

if (!inZip.equals(onDisk)) {
  console.error(
    `[check-failure-gate-zip-stale] FAIL: failure-gate-skill.zip is stale`,
  );
  console.error(
    `  The zip entry '${ZIP_ENTRY}' does not match .agents/skills/failure-gate-v4/SKILL.md.`,
  );
  console.error(
    `  This means the skill was edited after the zip was last generated.`,
  );
  console.error(REGEN_HINT);
  process.exit(1);
}

console.log(
  "[check-failure-gate-zip-stale] OK — failure-gate-skill.zip is up to date",
);
