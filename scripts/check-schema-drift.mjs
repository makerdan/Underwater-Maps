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

// ---------------------------------------------------------------------------
// Guard 1: migration ↔ journal ↔ snapshot pairing.
//
// Catches the "hand-written migration committed without its snapshot" gap
// (e.g. 0017_nullable_marker_dataset_id.sql landed journaled but without a
// regenerated meta snapshot, so subsequent drizzle-kit generate runs compared
// against a stale snapshot and could mask or false-fire drift).
//
// Rules:
//   a. Every journal entry tag must have a matching <tag>.sql migration file.
//   b. Every .sql migration file must be journaled (legacy pre-baseline files
//      absorbed by 0012_schema_baseline_sync are allowlisted).
//   c. Every journal entry must have a matching meta/<idx>_snapshot.json
//      (legacy hand-written entries that predate this guard are allowlisted).
//      In particular the LATEST entry must always have a snapshot, otherwise
//      generate diffs against an older snapshot and drift goes undetected.
// ---------------------------------------------------------------------------

// Legacy .sql files that predate the journal and were absorbed into the
// 0012_schema_baseline_sync baseline. Do NOT add new entries here — journal
// every new migration instead.
const LEGACY_UNJOURNALED_SQL = new Set([
  "0006_add_hyd93_features",
  "0007_add_needs_georeferencing",
  "0008_add_rate_limit_events_created_at_idx",
  "0009_add_upload_job_meta_columns",
  "0010_add_stage_started_at",
  "0011_add_upload_calibration",
  "0017_add_catalog_save_folder_id",
]);

// Legacy hand-written journaled migrations committed without a regenerated
// snapshot, before this guard existed. Their schema deltas are captured by
// later generated snapshots. Do NOT add new entries here — regenerate the
// snapshot (drizzle-kit generate) alongside every new migration instead.
const LEGACY_SNAPSHOTLESS_TAGS = new Set([
  "0004_add_folder_userid_indexes",
  "0005_add_disabled_presets",
  "0015_add_quick_drop_conditions",
  "0016_add_poe_usage_provider",
  "0017_nullable_marker_dataset_id",
]);

function checkMigrationSnapshotPairing() {
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const entries = journal.entries ?? [];
  const tags = new Set(entries.map((e) => e.tag));
  const sqlTags = new Set(
    readdirSync(drizzleDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -4)),
  );
  const snapshotIdxs = new Set(
    readdirSync(join(drizzleDir, "meta"))
      .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
      .map((f) => f.slice(0, 4)),
  );

  const problems = [];

  for (const tag of tags) {
    if (!sqlTags.has(tag)) {
      problems.push(`journal entry "${tag}" has no matching lib/db/drizzle/${tag}.sql file`);
    }
  }

  for (const tag of sqlTags) {
    if (!tags.has(tag) && !LEGACY_UNJOURNALED_SQL.has(tag)) {
      problems.push(
        `migration file lib/db/drizzle/${tag}.sql is not journaled in meta/_journal.json — ` +
          `the migrator will silently skip it`,
      );
    }
  }

  for (const entry of entries) {
    const idx = String(entry.idx).padStart(4, "0");
    if (!snapshotIdxs.has(idx) && !LEGACY_SNAPSHOTLESS_TAGS.has(entry.tag)) {
      problems.push(
        `journal entry idx ${entry.idx} ("${entry.tag}") has no matching ` +
          `lib/db/drizzle/meta/${idx}_snapshot.json — commit the regenerated snapshot ` +
          `alongside the migration (cd lib/db && pnpm exec drizzle-kit generate --config ./drizzle-check.config.ts)`,
      );
    }
  }

  if (entries.length > 0) {
    const maxIdx = Math.max(...entries.map((e) => e.idx));
    const latest = entries.find((e) => e.idx === maxIdx);
    const idx = String(maxIdx).padStart(4, "0");
    if (!snapshotIdxs.has(idx)) {
      problems.push(
        `the LATEST journal entry ("${latest.tag}") has no meta/${idx}_snapshot.json — ` +
          `drizzle-kit will diff against a stale snapshot and drift will be masked. ` +
          `This may NOT be allowlisted; regenerate and commit the snapshot.`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("ERROR: migration/snapshot pairing check failed:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("");
    console.error("Every committed migration must be journaled and every journal entry must");
    console.error("have a committed snapshot. Regenerate via:");
    console.error("  cd lib/db && pnpm exec drizzle-kit generate --config ./drizzle-check.config.ts");
    process.exit(1);
  }
  console.log(
    `check:schema-drift — migration/journal/snapshot pairing OK (${entries.length} journal entries).`,
  );
}

checkMigrationSnapshotPairing();

// ---------------------------------------------------------------------------
// Guard 2: schema ↔ snapshot drift (original check).
// ---------------------------------------------------------------------------

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
