---
name: api-server unit-suite baseline
description: Latest known pass/fail baseline for the two api-server vitest shards and the causes of the remaining failures.
---

# api-server unit-suite baseline (2026-07-31)

After the datasets.ts mis-merge repair: shard 1 fully green (98 files / 1369 tests); shard 2 green **except** two files, ~10 tests:

- `src/routes/__tests__/admin.test.ts` — GET /admin/rate-limit/usage tests get 401 instead of 200/400 (admin auth gating vs test mock drift).
- `src/__tests__/rate-limit-prune.test.ts` — `pool.connect is not a function`: the "Background job locking & graceful shutdown" commit moved `rateLimitPruneJob.ts` to `pool.connect()` for advisory locks, but the test's `@workspace/db` mock only stubs `pool.query`.

**Why:** these pre-date the datasets.ts repair, live outside datasets.ts, and fail deterministically with the same cause in isolation.

**How to apply:** treat only these as pre-existing when validating api-server work; anything else failing is new. The older note about pdf-upload/raster-routes SSE failures is obsolete — those pass now.

Run shards directly with `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --shard=N/2` (~3 min each).
