---
name: lib/db constraint tests use hand-written DDL
description: Adding a column to a lib/db schema table breaks lib/db vitest until test-db.ts DDL is updated too
---

# lib/db constraint tests use hand-written DDL

lib/db's constraint tests (`lib/db/src/__tests__/*.test.ts`) do NOT create tables from the Drizzle schema. They run against a real Postgres schema created by hand-written `CREATE TABLE` SQL in `lib/db/src/__tests__/test-db.ts`.

**Why it matters:** Drizzle generates INSERTs listing every schema column. Adding a column to `lib/db/src/schema/*` without adding it to the matching `CREATE TABLE` in test-db.ts makes every insert in those suites fail with "Failed query: insert into …" (column does not exist). This fails the standard-tier `test:unit` step even though the app code is fine.

**How to apply:** Whenever a migration adds/renames a column on `dataset_folders`, `custom_datasets`, `user_catalog_saves`, or `markers`, update the corresponding DDL in test-db.ts in the same commit, then run `cd lib/db && pnpm exec vitest run` (fast, ~3 s) to confirm.
