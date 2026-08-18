---
name: Drizzle journal cannot bootstrap a fresh DB
description: Why `drizzle-kit migrate` always fails on an empty database in this repo, and why push --force is the only path everywhere.
---

# Drizzle journal cannot bootstrap a fresh DB

**Rule:** never use `drizzle-kit migrate` (the `@workspace/db` `migrate` script) to set up an empty database — locally, in CI, or anywhere. Use `push`/`push-force` (schema-derived DDL) instead.

**Why:** the committed migration journal was hand-repaired around an already-populated dev database and is order-broken for a from-scratch replay:
- `0000_baseline.sql` is an empty stub (just a comment header).
- The real schema baseline lives in `0012_schema_baseline_sync`, journaled at idx 6 — *after* `0001_add_userid_indexes_markers_notnull`, which `DELETE`s from `markers` before any journaled migration creates it.
- Several committed SQL files (0006–0011 range and others) are not journaled at all.
- `drizzle-kit migrate` swallows the SQL error: it prints only a spinner and exits 1 with no message, all migrations roll back (0 applied). To find the failing statement, replay `_journal.json` entries manually with pg, splitting on `--> statement-breakpoint`.

**How to apply:** any fresh-database setup (CI service containers, scratch DBs, new environments) must run `pnpm --filter @workspace/db run push-force`. Verified: push --force bootstraps a fresh Postgres cleanly. This matches post-merge.sh, which already uses push for the same reason. If someone wants `migrate` to work someday, the journal needs a rebuilt, ordered baseline — a deliberate project, not a quick fix.
