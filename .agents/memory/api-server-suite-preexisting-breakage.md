---
Status: RESOLVED — test-standard is fully green (176/176 api-server files) as of 2026-07-20. Do NOT use this entry to justify skipping validation anymore. Keep the debugging discipline (run failing files solo before blaming your diff) plus the durable failure classes below.

Failure classes that were fixed (watch for recurrence when adding new tests):
- Rule 1: any test file that `vi.mock`s `lib/terrain.js` with an object-literal factory must export every const that transitive imports read at module-load time (currently `ALL_PRESET_DATASETS`, `BUNDLED_TERRAIN`, `NYSDEC_BATHY_FEATURE_SERVICE`, `MN_DNR_BATHY_FEATURE_SERVICE`). `catalogFetchStrategy.ts` reads the feature-service URLs at import via `routes/terrain-bundles.ts`, so a missing export fails the whole suite file, not one test.
- Rule 2: module-level `process.env["X"] = "1"` in a test file leaks to every later file in singleFork mode; `vi.unstubAllEnvs()` in a victim file does NOT undo direct assignments. Save the previous value and restore it in `afterAll` (pattern now in terrain-bundles tests). Symptom: auth-bypass guard tests get 500/bypass instead of 401 only in the full run.
- Rule 3: the `rate-limit-isolation.guard` static test requires every file importing `app.js` to reference `__resetRateLimitMemory`; new route test files trip it. Also `catalog-search.test.ts` requires a `PRIMARY_KEYWORD_QUERIES` entry per `EXTRA_CATALOG_ENTRIES` id — adding catalog entries without test keywords breaks the suite.
- Query-param validation on admin routes returns error code `invalid_param` (route opts in via `errorCode`), while body validation returns `invalid_request`; assert accordingly.

**Why:** these classes caused ~70 pre-existing failures that masked real regressions; each is a module-init, env-leak, or guard-test coupling that is not obvious from the failing test alone.
**How to apply:** copy an existing complete terrain mock factory; pair module-scope env writes with afterAll restore; when adding catalog entries, add keyword queries in the same change.
