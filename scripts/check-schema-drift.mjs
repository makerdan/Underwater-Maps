#!/usr/bin/env node
/**
 * check-schema-drift.mjs — Database schema drift check.
 *
 * Verifies that the Drizzle TypeScript schema (lib/db/src/schema/) is in sync
 * with the committed migration snapshots (lib/db/drizzle/meta/).
 *
 * Strategy (mirrors check:codegen-stale):
 *   1. Back up lib/db/drizzle/meta/_journal.json and record the set of files
 *      currently in lib/db/drizzle/ (recursively).
 *   2. Run `drizzle-kit generate` with the DB-free check config
 *      (lib/db/drizzle-check.config.ts). If the schema matches the latest
 *      snapshot, drizzle-kit produces no new files.
 *   3. If new files appeared, the schema has drifted: delete them, restore
 *      the journal, and fail with remediation instructions.
 *
 * Remediation when this fails:
 *   cd lib/db && pnpm exec drizzle-kit generate --config ./drizzle-check.config.ts
 *   git add lib/db/drizzle && commit the new migration + snapshot.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = resolve(root, "lib", "db");
const drizzleDir = join(dbDir, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");

function listFiles(dir) {
  const out = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.add(join(entry.parentPath ?? entry.path, entry.name));
  }
  return out;
}

const journalBackup = readFileSync(journalPath, "utf8");
const before = listFiles(drizzleDir);

let generateFailed = false;
try {
  execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--config", "./drizzle-check.config.ts"], {
    cwd: dbDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  generateFailed = true;
  console.error("ERROR: drizzle-kit generate failed:");
  console.error(String(err.stdout ?? ""));
  console.error(String(err.stderr ?? err.message));
}

const after = listFiles(drizzleDir);
const created = [...after].filter((f) => !before.has(f));

// Always clean up: remove any files generate created and restore the journal.
for (const f of created) rmSync(f, { force: true });
writeFileSync(journalPath, journalBackup);

if (generateFailed) process.exit(1);

if (created.length > 0) {
  console.error("ERROR: Database schema drift detected.");
  console.error("");
  console.error("The Drizzle schema in lib/db/src/schema/ has changed but no migration");
  console.error("snapshot was generated. drizzle-kit produced:");
  for (const f of created) console.error(`  - ${f.replace(root + "/", "")}`);
  console.error("");
  console.error("To fix, regenerate the migration + snapshot and commit the result:");
  console.error("  cd lib/db && pnpm exec drizzle-kit generate --config ./drizzle-check.config.ts");
  console.error("  git add lib/db/drizzle");
  console.error("");
  console.error("(The stray files above have been cleaned up automatically.)");
  process.exit(1);
}

console.log("check:schema-drift — Drizzle schema is in sync with committed snapshots.");
