---
name: api-server unit suite pre-existing breakage (FIXED 2026-07-20)
description: The 2026-07-20 pre-existing api-server failures are repaired; suite is green. Patterns to watch for when new failures of the same classes appear. (Previously: 4 tests/9 files including NYSDEC terrain mock suites, catalog-search coverage, rate-limit guard, admin invalid_param).
---
Status: FIXED — test-standard is fully green (176/176 api-server files) as of 2026-07-20. Do NOT use this entry to justify skipping validation anymore.

Failure classes that were fixed (watch for recurrence when adding new tests):
- Any test that vi.mocks `lib/terrain.js` must export `NYSDEC_BATHY_FEATURE_SERVICE`, `MN_DNR_BATHY_FEATURE_SERVICE`, and `BUNDLED_TERRAIN` — `catalogFetchStrategy.ts` reads them at module init via `routes/terrain-bundles.ts`, so a missing export fails the whole file at collect time.
- Every test file importing `app.js` must reference `__resetRateLimitMemory` (real import + beforeEach, or as an export in a rateLimit.js mock) — enforced by rate-limit-isolation.guard.test.ts.
- Query-param validation on admin routes returns error code `invalid_param` (route opts in via `errorCode`), while body validation returns `invalid_request`; assert accordingly.
- New EXTRA_CATALOG_ENTRIES ids must be added to PRIMARY_KEYWORD_QUERIES in catalog-search.test.ts with a distinctive keyword query, or two freshness guards fail.

**Why:** these classes caused ~70 pre-existing failures that masked real regressions; each is a module-init or guard-test coupling that is not obvious from the failing test alone.
**How to apply:** when a whole api-server file fails at collect with a "No X export defined on mock" error, check the transitive module-init imports of the mocked module, not the test body.
