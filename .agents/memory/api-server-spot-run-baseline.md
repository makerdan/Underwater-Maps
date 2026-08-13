---
name: api-server unit-suite baseline
description: Latest known pass/fail baseline for the two api-server vitest shards and the causes of the remaining failures.
---

# api-server unit-suite baseline (2026-08-13)

## Current baseline — run date 2026-08-13

### Static checks (fast tier) — all GREEN
typecheck, lint, and all 13 static check steps pass cleanly.
- typecheck: api-server, bathyscan, scripts, mockup-sandbox all pass.
- lint: clean.
- All check:* steps (lock-skill-sync, failure-gate-zip, poe-setup-zip, port-authority-zip/heavy, root-relative-api, deps-suppression, duplicate-hooks-registry, runner-step-sync, fix:failure-gate-stubs, check:failure-gate, skip-count, testdb-schema-drift): all pass.

### test:unit — FAIL (bathyscan only)

**api-server shards**: GREEN — both shards pass. No failures.
- lib/api-zod: 1 file / 124 tests — PASS
- lib/db: 4 files / 33 tests — PASS
- lib/poe: 8 files / 59 tests — PASS
- scripts: scheduled-refresh — PASS

**bathyscan vitest**: 4 files failed | 312 passed (316 total files); 9 tests failed | 4257 passed
- Duration: ~145–230 s (budget 1200s, well within)

**Failing files (bathyscan, all deterministic — confirmed identical in 2 independent runs):**

1. `src/__tests__/MarkerLayer.subsampling.test.tsx` — **Suite crash**: `No "DEFAULT_SETTINGS" export on "@/lib/settingsStore"`. The settingsStore mock in this file doesn't export `DEFAULT_SETTINGS`, but `uiStore.ts:555` reads it at module-init time (`const s = DEFAULT_SETTINGS`). All tests in file crash before running. See memory note: `settingsStore-mock-persist.md`.

2. `src/__tests__/MarkerLayer.terrainPerDataset.test.tsx` — **6 failing tests**: `lonLatToWorldXZ(100, 45, grid)` returns `x ≈ 0` instead of expected `-WORLD_SIZE/2 = -50`. Suggests a regression in the `lonLatToWorldXZ` coordinate mapping logic (likely a recent change to how the X offset is computed from the grid).

3. `src/__tests__/overviewMap.componentIntegration.test.ts` — **1 failing test**: `puzzleGeoTransforms.size` expected `0` got `1` after a puzzle resize event. The `[puzzleTransforms] effect` that should clear transforms when size=0 is not firing or clearing correctly.

4. **4th file** (2 failing tests) — not identifiable from truncated log output. All 9 = 6 (terrainPerDataset) + 1 (overviewMap) + 2 (4th unknown).

**Classification:** All 4 bathyscan files are new regressions as of this run — they were not listed in the 2026-07-31 baseline. They fail deterministically (both independent runs gave identical results). Do not treat as flaky.

**test-standard budget note:** The workflow timed out at the 1200s budget because 5 other test runners competed simultaneously. The timeout-guard verdict was "LIKELY BUDGET BREACH UNDER LOAD." Unit test results are drawn from test-standard-skip-typecheck and test-standard-plus which ran the same suite under the same conditions. The budget breach is NOT a signal of a hanging test.

---

## Previous baseline — 2026-07-31

After the datasets.ts mis-merge repair: shard 1 fully green (98 files / 1369 tests); shard 2 green **except** two files, ~10 tests (admin.test.ts 401 drift, rate-limit-prune pool.connect gap) — both fixed by migrating to shared `createDbPoolMock()` factory.

Run shards directly with `NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --shard=N/2` (~3 min each).

Update 2026-07-31 (later): admin.test.ts 401 drift and rate-limit-prune pool.connect gaps fixed. Baseline bathyscan typecheck breakage ("synthetic"/TerrainData errors) was a blocker — now resolved.
