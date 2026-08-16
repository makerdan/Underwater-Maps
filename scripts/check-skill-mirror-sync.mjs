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
 *       • Exits 1 with a remediation hint if the hashes differ.
 *   - Exits 0 when all fingerprints match.
 *
 * Usage:
 *   node scripts/check-skill-mirror-sync.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
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

const failures = [];
let checked = 0;

for (const canonicalName of canonicalSkills) {
  const localName = localNameMap.get(canonicalName.toLowerCase());
  if (!localName) {
    // No counterpart in .local/custom_skills/ — out of scope per spec.
    continue;
  }

  const canonicalSkillMd = join(CANONICAL_DIR, canonicalName, "SKILL.md");
  const fingerprintPath = join(LOCAL_DIR, localName, ".fingerprint");

  if (!existsSync(canonicalSkillMd)) {
    // Canonical skill dir exists but has no SKILL.md — skip silently.
    continue;
  }

  if (!existsSync(fingerprintPath)) {
    failures.push({
      name: canonicalName,
      kind: "missing-fingerprint",
      canonicalSkillMd,
      fingerprintPath,
    });
    checked++;
    continue;
  }

  const storedFingerprint = readFileSync(fingerprintPath, "utf8").trim();
  const actualMd5 = md5OfFile(canonicalSkillMd);
  checked++;

  if (storedFingerprint !== actualMd5) {
    failures.push({
      name: canonicalName,
      kind: "stale",
      stored: storedFingerprint,
      actual: actualMd5,
      canonicalSkillMd,
      localSkillMd: join(LOCAL_DIR, localName, "SKILL.md"),
      fingerprintPath,
    });
  }
}

if (failures.length === 0) {
  console.log(
    `[check-skill-mirror-sync] OK — all ${checked} skill mirror fingerprint(s) match.`,
  );
  process.exit(0);
}

console.error(
  `[check-skill-mirror-sync] FAIL — ${failures.length} skill mirror(s) are stale:\n`,
);

for (const f of failures) {
  if (f.kind === "missing-fingerprint") {
    console.error(`  Skill: ${f.name}`);
    console.error(`    Problem:  .fingerprint file missing`);
    console.error(`    Expected: ${f.fingerprintPath}`);
    console.error(
      `    Fix:      Run the post-merge sync step to re-copy and re-fingerprint this skill,`,
    );
    console.error(
      `              or manually copy ${f.canonicalSkillMd}`,
    );
    console.error(
      `              to the local directory and write its md5 to .fingerprint.\n`,
    );
  } else {
    console.error(`  Skill: ${f.name}`);
    console.error(`    Stored fingerprint:  ${f.stored}`);
    console.error(`    Canonical md5:       ${f.actual}`);
    console.error(`    Canonical source:    ${f.canonicalSkillMd}`);
    console.error(`    Stale local copy:    ${f.localSkillMd}`);
    console.error(
      `    Fix:      Run the post-merge sync step to re-copy and re-fingerprint this skill.`,
    );
    console.error(
      `              The canonical source is .agents/skills/${f.name}/SKILL.md — edit it there,`,
    );
    console.error(
      `              never in .local/custom_skills/ (those copies are overwritten on sync).\n`,
    );
  }
}

console.error(
  "To repair all stale mirrors at once, run the post-merge sync step\n" +
  "(or trigger a merge, which runs it automatically).",
);
process.exit(1);
