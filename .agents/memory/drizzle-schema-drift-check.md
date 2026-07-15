---
name: Drizzle schema-drift checking quirks
description: Gotchas when using drizzle-kit generate to detect schema drift in CI.
---

## Rule
1. A drizzle-kit config used for drift checking must use a **relative** `out` path. An absolute path makes `drizzle-kit generate` fail with ENOENT on a mangled `.//home/...` path.
2. If hand-written SQL migrations were added without journal entries (drizzle `meta/_journal.json`), `drizzle-kit generate` will see the snapshot as stale and always emit a "new" migration. Fix by creating a baseline sync migration + snapshot that captures the current schema, journaled properly, so drift checks only fire on real schema/migration divergence.

**Why:** Both issues produced false-positive drift failures when building the CI schema-drift check; the ENOENT error message is cryptic and doesn't mention the path config.

**How to apply:** When touching `lib/db/drizzle-check.config.ts`, the migrations journal, or adding migrations — hand-written migrations must get journal + snapshot entries or the drift check breaks.
