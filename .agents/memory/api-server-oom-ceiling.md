---
name: api-server singleFork OOM ceiling
description: api-server vitest singleFork pool peaks at ~6.9 GB RSS; raised --max-old-space-size to 8192 MB.
---

# api-server singleFork OOM ceiling

## The rule
The api-server vitest singleFork pool (which runs all test files in a single V8 process) peaks at ~6.9 GB RSS after the full suite. The previous 6144 MB ceiling caused OOM crashes. The ceiling is now 8192 MB.

**Why:** The singleFork pool reuses one Node.js process for all test files. Memory accumulates (live V8 heap + WASM buffers from parser tests) and is never GC'd between files. Peak observed: ~6916 MB RSS at `bag-h5wasm-init-failure.test.ts`.

## How to apply
Three places must be kept in sync:
1. `artifacts/api-server/vitest.config.ts` — `pool: "forks"` config's `execArgv: ["--max-old-space-size=8192"]`
2. `artifacts/api-server/package.json` — `NODE_OPTIONS=--max-old-space-size=8192` in the `test:unit` script
3. `tests/timeout-guard/budgets.json` — `rssWarnMb: 8192` for the `apiServerUnit` budget entry

If OOM crashes recur (e.g. new heavy test files added), increase all three in lockstep.
