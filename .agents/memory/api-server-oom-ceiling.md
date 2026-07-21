---
name: api-server unit suite memory — sharded run
description: api-server vitest singleFork suite outgrew any single-process heap; test:unit now runs two sequential shards.
---

# api-server unit suite memory — sharded run

## The rule
The api-server unit suite (185+ files, singleFork) accumulates heap across files and eventually OOMs a single V8 process regardless of `--max-old-space-size` (machine has ~15 GB total; crashes observed at ~6.6 GB heap with an 8192 MB cap). `test:unit` therefore runs **two sequential vitest shards**: `sh -c 'vitest run --shard=1/2 && vitest run --shard=2/2'`, which resets the process heap halfway through.

**Why:** singleFork reuses one process for the whole queue; per-file `global.gc()` calls (setup.ts, `--expose-gc`) slow but don't stop cumulative growth (module registries, WASM heaps, large fixtures). Raising the heap cap stopped working once the suite grew past ~185 files. Sharding passed in ~7.5 min where the unsharded run OOM'd at file 173/187.

## How to apply
- `artifacts/api-server/package.json` `test:unit` holds the sharded command; keep the shards sequential (`&&`), never parallel — tests share ports/DB.
- If OOM recurs as the suite grows further, move to `--shard=1/3 …/3` rather than raising `--max-old-space-size` again.
- Heap settings still kept in sync in: vitest.config.ts `execArgv`, package.json `NODE_OPTIONS`, budgets.json `rssWarnMb`.
- The `PortTestFirstSequencer` hoisting still applies within each shard.
