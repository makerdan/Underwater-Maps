#!/usr/bin/env node
/**
 * Non-destructive codegen staleness check.
 *
 * Backs up the current generated files, runs codegen:generate to get a fresh
 * copy, diffs the two, then restores the originals unconditionally.
 * Exits 0 if generated files are up to date, non-zero if they are stale.
 *
 * This is always a read-only check from the caller's perspective — the working
 * tree is left in exactly the state it was in when this script started.
 *
 * Run:  node scripts/check-codegen-stale.mjs
 *       pnpm check:codegen-stale
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GENERATED_DIRS = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];

// ---------------------------------------------------------------------------
// Back up current state
// ---------------------------------------------------------------------------
const backupRoot = mkdtempSync(resolve(tmpdir(), "codegen-stale-check-"));
try {
  for (const rel of GENERATED_DIRS) {
    const src = resolve(root, rel);
    const dst = resolve(backupRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Run codegen into the real output directories
  // ---------------------------------------------------------------------------
  const genResult = spawnSync(
    "pnpm",
    ["--filter", "@workspace/api-spec", "run", "codegen:generate"],
    { stdio: "inherit", cwd: root, shell: false },
  );
  if (genResult.status !== 0) {
    console.error("check:codegen-stale — codegen:generate failed; cannot determine staleness.");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Diff newly-generated files vs backup
  // ---------------------------------------------------------------------------
  // Use git diff --no-index for each pair individually (simpler output control).
  let stale = false;
  for (const rel of GENERATED_DIRS) {
    const backupDir = resolve(backupRoot, rel);
    const realDir = resolve(root, rel);
    const backupExists = existsSync(backupDir);
    const realExists = existsSync(realDir);
    if (!backupExists && !realExists) continue;
    const diff = spawnSync(
      "git",
      ["diff", "--no-index", "--quiet",
        backupExists ? backupDir : "/dev/null",
        realExists   ? realDir   : "/dev/null",
      ],
      { stdio: "inherit", cwd: root, shell: false },
    );
    if (diff.status !== 0) {
      stale = true;
    }
  }

  if (stale) {
    console.error(
      "ERROR: Generated API client is stale. " +
      "Run `pnpm --filter @workspace/api-spec run codegen:generate` and commit the result.",
    );
  } else {
    console.log("check:codegen-stale — generated files are up to date. ✓");
  }
  process.exitCode = stale ? 1 : 0;
} finally {
  // ---------------------------------------------------------------------------
  // Restore originals unconditionally so the working tree is never modified
  // ---------------------------------------------------------------------------
  for (const rel of GENERATED_DIRS) {
    const realDir = resolve(root, rel);
    const backupDir = resolve(backupRoot, rel);
    // Remove whatever codegen wrote
    if (existsSync(realDir)) rmSync(realDir, { recursive: true, force: true });
    // Restore from backup (if the dir existed before we started)
    if (existsSync(backupDir)) {
      mkdirSync(realDir, { recursive: true });
      cpSync(backupDir, realDir, { recursive: true });
    }
  }
  rmSync(backupRoot, { recursive: true, force: true });
}
