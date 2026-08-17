#!/usr/bin/env node
/**
 * check-skill-mirror-sync.mjs — Drift guard between canonical skill sources
 * (.agents/skills/<name>/SKILL.md) and their live copies in
 * .local/custom_skills/<name>/SKILL.md.
 *
 * Replit populates .local/custom_skills/ at install time; .local/ is
 * gitignored, so those copies are never updated by git and can silently fall
 * behind the canonical .agents/skills/ source. This script detects drift by
 * comparing the md5 of each canonical SKILL.md against the stored
 * .fingerprint file in the corresponding .local/custom_skills/<name>/
 * directory.
 *
 * Behaviour:
 *   - If .local/custom_skills/ does not exist (fresh CI, no install):
 *     prints a skip notice and exits 0.
 *   - For each subdirectory in .agents/skills/ that also has a counterpart
 *     in .local/custom_skills/:
 *       • Reads .local/custom_skills/<name>/.fingerprint
 *       • Computes the md5 of .agents/skills/<name>/SKILL.md
 *       • If the hashes differ (or the fingerprint is missing), AUTO-REPAIRS
 *         by re-copying the canonical SKILL.md and re-writing the fingerprint,
 *         then logs a warning. This is safe because the mirrors are gitignored
 *         derived copies — the canonical file is the source of truth.
 *       • Exits 1 only for genuinely unfixable states (e.g. the canonical
 *         SKILL.md cannot be read, or the repair write fails).
 *   - Exits 0 when all fingerprints match (or were successfully repaired).
 *
 * Usage:
 *   node scripts/check-skill-mirror-sync.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const CANONICAL_DIR = resolve(root, ".agents/skills");
const LOCAL_DIR = resolve(root, ".local/custom_skills");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md5OfFile(filePath) {
  const content = readFileSync(filePath);
  return createHash("md5").update(content).digest("hex");
}

function subdirs(dir) {
  try {
    return readdirSync(dir).filter((name) => {
      try {
        return statSync(join(dir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return null; // directory does not exist
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(LOCAL_DIR)) {
  console.log(
    "[check-skill-mirror-sync] SKIP — .local/custom_skills/ does not exist " +
    "(expected in fresh CI environments where the platform has not populated it).",
  );
  process.exit(0);
}

const canonicalSkills = subdirs(CANONICAL_DIR) ?? [];
const localSkillSet = new Set(
  (subdirs(LOCAL_DIR) ?? []).map((n) => n.toLowerCase()),
);

// Build a case-insensitive map from local name → canonical name so we can
// match e.g. "port-authority" (local) with "Port-Authority" (canonical).
const localNameMap = new Map();
for (const localName of (subdirs(LOCAL_DIR) ?? [])) {
  localNameMap.set(localName.toLowerCase(), localName);
}

// ---------------------------------------------------------------------------
// Repair helper — mirrors are gitignored derived copies; re-copying is safe.
// Returns true on success, false if the repair could not be completed.
// ---------------------------------------------------------------------------

function repairMirror(canonicalSkillMd, localSkillMd, fingerprintPath) {
  try {
    copyFileSync(canonicalSkillMd, localSkillMd);
    const actualMd5 = md5OfFile(canonicalSkillMd);
    writeFileSync(fingerprintPath, actualMd5 + "\n", "utf8");
    return true;
  } catch (err) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main check + auto-repair loop
// ---------------------------------------------------------------------------

let checked = 0;
let repaired = 0;
const hardFailures = []; // genuinely unfixable (canonical unreadable / write failed)

for (const canonicalName of canonicalSkills) {
  const localName = localNameMap.get(canonicalName.toLowerCase());
  if (!localName) {
    // No counterpart in .local/custom_skills/ — out of scope per spec.
    continue;
  }

  const canonicalSkillMd = join(CANONICAL_DIR, canonicalName, "SKILL.md");
  const fingerprintPath = join(LOCAL_DIR, localName, ".fingerprint");
  const localSkillMd = join(LOCAL_DIR, localName, "SKILL.md");

  if (!existsSync(canonicalSkillMd)) {
    // Canonical skill dir exists but has no SKILL.md — skip silently.
    continue;
  }

  checked++;

  // Determine whether a repair is needed.
  let needsRepair = false;
  let repairReason = "";

  if (!existsSync(fingerprintPath)) {
    needsRepair = true;
    repairReason = "missing .fingerprint";
  } else {
    const storedFingerprint = readFileSync(fingerprintPath, "utf8").trim();
    const actualMd5 = md5OfFile(canonicalSkillMd);
    if (storedFingerprint !== actualMd5) {
      needsRepair = true;
      repairReason = `fingerprint mismatch (stored=${storedFingerprint.slice(0, 8)}… actual=${actualMd5.slice(0, 8)}…)`;
    }
  }

  if (!needsRepair) {
    continue;
  }

  // Attempt auto-repair: re-copy canonical → mirror and re-write fingerprint.
  const ok = repairMirror(canonicalSkillMd, localSkillMd, fingerprintPath);
  if (ok) {
    console.warn(
      `[check-skill-mirror-sync] WARN — repaired stale mirror for skill "${canonicalName}" (${repairReason}).`,
    );
    repaired++;
  } else {
    // Repair failed — this is a hard failure (e.g. unreadable canonical or
    // read-only local dir). Report it so the operator knows.
    console.error(
      `[check-skill-mirror-sync] ERROR — could not repair mirror for skill "${canonicalName}" (${repairReason}).`,
    );
    console.error(
      `  Canonical source: ${canonicalSkillMd}`,
    );
    console.error(
      `  Local mirror:     ${localSkillMd}`,
    );
    hardFailures.push(canonicalName);
  }
}

if (hardFailures.length > 0) {
  console.error(
    `\n[check-skill-mirror-sync] FAIL — ${hardFailures.length} skill mirror(s) could not be repaired: ${hardFailures.join(", ")}`,
  );
  console.error(
    "Check that the canonical SKILL.md files are readable and .local/custom_skills/ is writable.",
  );
  process.exit(1);
}

const repairedNote = repaired > 0 ? `, auto-repaired ${repaired}` : "";
console.log(
  `[check-skill-mirror-sync] OK — all ${checked} skill mirror fingerprint(s) match${repairedNote}.`,
);
process.exit(0);
