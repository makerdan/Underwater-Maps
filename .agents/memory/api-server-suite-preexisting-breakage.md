---
name: api-server unit suite baseline
description: The 2026-07-20 pre-existing api-server test breakage was repaired; how to debug new failures and keep the baseline green.
---
Rule: the api-server unit suite baseline is green (repaired 2026-07-20); do NOT treat failures as pre-existing — run the failing file solo and capture the real error behind asyncHandler 500s with a temporary express error middleware.

Lessons from the repair:
- Mocks of `lib/terrain.js` must export every const that `catalogFetchStrategy.ts` imports (NYSDEC_BATHY_FEATURE_SERVICE, MN_DNR_BATHY_FEATURE_SERVICE, BUNDLED_TERRAIN, ALL_PRESET_DATASETS). Adding a new terrain export consumed at module init breaks every test file that fully mocks terrain.js — copy the export list from terrain-bundles.test.ts's mock.
- The rate-limit-isolation guard requires every test file importing app.js to call `__resetRateLimitMemory()` in a beforeEach.
- New EXTRA_CATALOG_ENTRIES ids must be added to PRIMARY_KEYWORD_QUERIES in catalog-search.test.ts (a name-based query like "Seneca Lake, NY" reliably surfaces the entry).
- Admin rate-limit-usage query validation intentionally uses errorCode "invalid_param" (see routes/admin.ts), not the default "invalid_request".

**How to apply:** when the full suite fails but the file passes solo, suspect cross-file contamination (see other memory topics), not this baseline.
