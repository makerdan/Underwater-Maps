---
name: terrain.js mock export sync
description: Full vi.mock of lib/terrain.js must include every export read at module init, or app-loading tests crash suite-wide.
---
Rule: any test that fully mocks `lib/terrain.js` and loads the app must stub ALL terrain exports consumed at module-init time (currently BUNDLED_TERRAIN, NYSDEC_BATHY_FEATURE_SERVICE, MN_DNR_BATHY_FEATURE_SERVICE via catalogFetchStrategy.ts, imported by the terrain-bundles route).

**Why:** The on-demand bathymetry feature added module-init reads of these constants; 17 test files with full terrain mocks crashed with "No X export is defined on the mock", and the crash surfaced as misleading downstream errors (e.g. missing __resetRateLimitMemory) in neighboring files.

**How to apply:** When adding a new module-init-consumed export to lib/terrain.js, grep for `vi.mock(".*lib/terrain.js"` and add a stub to every full-mock factory. A guard test to automate this is proposed as a follow-up.

## Generalized (2026-07-21)
tileClassify, shoreZoneData and bucketMonitor now also have shared factories (`__tests__/helpers/{tileClassifyMock,shoreZoneDataMock,bucketMonitorMock}.ts`) guarded by `mock-factory-guards.test.ts` (both missing and stale keys). All wholesale mocks of these modules go through the factories with per-suite overrides. For any NEW wholesale-mocked module, copy this pattern and add a case to the guard's CASES array.

## Merge-duplicated mock keys (2026-07-20)
Task merges can DUPLICATE terrain mock exports inside vi.mock factories (same key 2-3x, sometimes with conflicting values like `BUNDLED_TERRAIN: {}` vs `[]`), producing TS1117 across many api-server route test files. Fix by deduping to one set — keep `BUNDLED_TERRAIN: {}` (real export is a Record) and any getter forms. Caught by typecheck, so the fast tier fails loudly; just dedupe rather than debug the mocks.
