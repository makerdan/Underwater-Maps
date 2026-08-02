#!/usr/bin/env node
/**
 * check-port-authority-zip-stale.mjs — Drift guard between
 * artifacts/bathyscan/public/port-authority-skill.zip and
 * .agents/skills/Port-Authority/SKILL.md.
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
 *   node scripts/check-port-authority-zip-stale.mjs
 *   pnpm run check:port-authority-zip
 *
 * To regenerate the zip manually:
 *   (cd .agents/skills && zip ../../artifacts/bathyscan/public/port-authority-skill.zip Port-Authority/SKILL.md)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SKILL_PATH = resolve(root, ".agents/skills/Port-Authority/SKILL.md");
const ZIP_PATH = resolve(root, "artifacts/bathyscan/public/port-authority-skill.zip");
const ZIP_ENTRY = "Port-Authority/SKILL.md";

const REGEN_HINT =
  "  Regenerate: (cd .agents/skills && zip ../../artifacts/bathyscan/public/port-authority-skill.zip Port-Authority/SKILL.md)";

// ---------------------------------------------------------------------------
// Existence checks
// ---------------------------------------------------------------------------

if (!existsSync(SKILL_PATH)) {
  console.error(
    `[check-port-authority-zip-stale] ERROR: skill source not found: ${SKILL_PATH}`,
  );
  console.error("  Ensure .agents/skills/Port-Authority/SKILL.md exists.");
  process.exit(1);
}

if (!existsSync(ZIP_PATH)) {
  // No zip published yet — nothing to validate. This is the expected state
  // until a downloadable copy is intentionally published under
  // artifacts/bathyscan/public/port-authority-skill.zip.
  console.log(
    "[check-port-authority-zip-stale] SKIP — port-authority-skill.zip not yet published; nothing to validate",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Extract the entry from the zip into a temp directory and compare
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "port-authority-zip-check-"));
try {
  const result = spawnSync(
    "unzip",
    ["-p", ZIP_PATH, ZIP_ENTRY],
    { encoding: "buffer" },
  );

  if (result.status !== 0) {
    console.error(
      `[check-port-authority-zip-stale] FAIL: could not extract '${ZIP_ENTRY}' from ${ZIP_PATH}`,
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
      `[check-port-authority-zip-stale] FAIL: port-authority-skill.zip is stale`,
    );
    console.error(
      `  The zip entry '${ZIP_ENTRY}' does not match .agents/skills/Port-Authority/SKILL.md.`,
    );
    console.error(
      `  This means the skill was edited after the zip was last generated.`,
    );
    console.error(REGEN_HINT);
    process.exit(1);
  }

  console.log(
    "[check-port-authority-zip-stale] OK — port-authority-skill.zip is up to date",
  );
  process.exit(0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
