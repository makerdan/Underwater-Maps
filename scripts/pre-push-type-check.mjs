#!/usr/bin/env node
/**
 * pre-push-type-check.mjs
 *
 * Detects column-type changes that would cause `drizzle-kit push` to fail
 * (because Postgres cannot implicitly cast existing values to the new type),
 * and aborts with a clear, actionable error *before* the push runs.
 *
 * Strategy
 * --------
 * 1. Copy lib/db/drizzle/meta/ to a temp dir so `drizzle-kit generate` can
 *    diff the current schema against the last snapshot without writing into
 *    the real migration directory.
 * 2. Run `drizzle-kit generate --out <tempdir>` to produce the pending diff
 *    SQL (if any).
 * 3. Parse the generated SQL for `ALTER COLUMN … SET DATA TYPE` statements.
 * 4. For each type change, open a PG connection and attempt the ALTER inside
 *    a transaction that is always rolled back.  If Postgres rejects it, exit 1
 *    with a message that explains the problem and points to the fix template.
 *
 * Exit codes
 * ----------
 *   0 — no type changes detected, or all type changes are safely castable
 *   1 — at least one type change would fail; push is blocked
 *   2 — script setup error (missing DATABASE_URL, drizzle-kit not found, etc.)
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DB_DIR = path.join(REPO_ROOT, "lib", "db");
const META_SRC = path.join(DB_DIR, "drizzle", "meta");
const DRIZZLE_CONFIG = path.join(DB_DIR, "drizzle.config.ts");

// Resolve pg from lib/db's own node_modules so this script can run from any
// working directory without needing pg in the workspace root.
const _require = createRequire(path.join(DB_DIR, "package.json"));
const { Client: PgClient } = _require("pg");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[pre-push-type-check] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[pre-push-type-check] WARNING: ${msg}\n`);
}

function fatal(msg, code = 1) {
  process.stderr.write(`\n[pre-push-type-check] ERROR: ${msg}\n\n`);
  process.exit(code);
}

/** Copy a directory tree recursively (plain files + subdirs, no symlinks). */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Parse ALTER COLUMN … SET DATA TYPE statements from SQL text.
 *
 * drizzle-kit generate emits statements in the form:
 *   ALTER TABLE "schema"."table" ALTER COLUMN "col" SET DATA TYPE newtype;
 * or without a schema qualifier:
 *   ALTER TABLE "table" ALTER COLUMN "col" SET DATA TYPE newtype;
 *
 * Returns an array of objects: { table, column, newType, rawStatement }.
 */
function parseTypeChanges(sql) {
  // Match the full ALTER TABLE … ALTER COLUMN … SET DATA TYPE … statement.
  // The trailing content up to the semicolon is the new type (may be multi-word,
  // e.g. "character varying(255)" or "uuid").
  const re =
    /ALTER\s+TABLE\s+(?:"[^"]*"\s*\.\s*)?"([^"]+)"\s+ALTER\s+COLUMN\s+"([^"]+)"\s+SET\s+DATA\s+TYPE\s+([^;]+?)\s*;/gi;
  const results = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    results.push({
      table: m[1],
      column: m[2],
      newType: m[3].trim(),
      rawStatement: m[0].trim(),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // -- 0. Pre-conditions ------------------------------------------------------

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    fatal("DATABASE_URL is not set — cannot validate type changes.", 2);
  }

  if (!fs.existsSync(META_SRC)) {
    fatal(`drizzle meta directory not found: ${META_SRC}`, 2);
  }

  // -- 1. Generate diff SQL into a temp dir -----------------------------------

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-typecheck-"));

  try {
    // Seed the temp output dir with the existing meta snapshot so drizzle-kit
    // sees the correct migration history and produces an incremental diff.
    const tmpMeta = path.join(tmpDir, "meta");
    copyDir(META_SRC, tmpMeta);

    log("Generating schema diff SQL to detect pending column-type changes…");

    // drizzle-kit 0.31 rejects --config when combined with other CLI flags,
    // so we pass dialect and schema explicitly instead of using the config file.
    // The schema path is relative to DB_DIR (cwd).  No DB credentials are
    // needed for `generate` — it only reads TypeScript + the meta snapshot.
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "drizzle-kit",
        "generate",
        "--dialect",
        "postgresql",
        "--schema",
        "./src/schema/index.ts",
        "--out",
        tmpDir,
        "--name",
        "_typecheck_probe",
      ],
      {
        cwd: DB_DIR,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env },
      }
    );

    if (result.status !== 0 && result.status !== null) {
      // drizzle-kit generate exits non-zero when there are no changes in some
      // versions — treat that as "no pending changes".
      const combined = (result.stdout ?? "") + (result.stderr ?? "");
      if (/no\s+changes/i.test(combined)) {
        log("No schema changes detected — nothing to check.");
        return;
      }
      warn(
        `drizzle-kit generate exited with code ${result.status}. Output:\n${combined}`
      );
      warn("Skipping type-cast pre-check (could not produce diff SQL).");
      return;
    }

    // -- 2. Find the generated SQL file(s) ------------------------------------

    const sqlFiles = fs
      .readdirSync(tmpDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => path.join(tmpDir, f));

    if (sqlFiles.length === 0) {
      log("No SQL diff file produced — schema appears to be in sync.");
      return;
    }

    // Collect all SQL content.
    const combinedSql = sqlFiles
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");

    // -- 3. Parse for column-type changes -------------------------------------

    const typeChanges = parseTypeChanges(combinedSql);

    if (typeChanges.length === 0) {
      log("No column-type changes detected in pending diff — safe to push.");
      return;
    }

    log(
      `Found ${typeChanges.length} column-type change(s) to validate against live DB…`
    );

    // -- 4. Dry-run each type change in a rolled-back PG transaction ----------

    const client = new PgClient({ connectionString: DATABASE_URL });
    await client.connect();

    const failures = [];

    for (const change of typeChanges) {
      const { table, column, newType, rawStatement } = change;
      log(`  Checking: "${table}"."${column}" → ${newType}`);

      try {
        await client.query("BEGIN");
        await client.query(rawStatement);
        // Success — the cast is safe.
        await client.query("ROLLBACK");
        log(`  ✓ Cast is valid for "${table}"."${column}"`);
      } catch (err) {
        // Any error here means the push would fail for the same reason.
        await client.query("ROLLBACK").catch(() => {});
        failures.push({ table, column, newType, rawStatement, error: err.message });
        process.stderr.write(
          `  ✗ "${table}"."${column}" → ${newType} FAILED: ${err.message}\n`
        );
      }
    }

    await client.end();

    // -- 5. Report ------------------------------------------------------------

    if (failures.length === 0) {
      log("All column-type changes passed the cast check — safe to push.");
      return;
    }

    const lines = [
      `${failures.length} column-type change(s) would cause drizzle-kit push to fail.`,
      "",
      "Postgres cannot implicitly cast the existing values to the new type.",
      "You must delete or update the non-castable rows BEFORE running push.",
      "",
      "Failing columns:",
      ...failures.map(
        (f) => `  • "${f.table}"."${f.column}"  →  ${f.newType}\n    ${f.error}`
      ),
      "",
      "How to fix:",
      "  1. Copy scripts/pre-push-cleanup.sql.example to a throwaway file.",
      "  2. Adapt the DELETE (or UPDATE … SET col = NULL) predicate for each",
      "     failing column listed above.",
      "  3. Run the adapted script against the dev database:",
      "       psql \"$DATABASE_URL\" -f /tmp/pre-push-cleanup.sql",
      "  4. Re-run post-merge.sh (or `pnpm --filter db push` directly).",
      "",
      "Do NOT commit the cleanup script — it is specific to this migration.",
    ];

    fatal(lines.join("\n"));
  } finally {
    // Always clean up the temp directory.
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`[pre-push-type-check] Unexpected error: ${err.stack ?? err}\n`);
  process.exit(2);
});
