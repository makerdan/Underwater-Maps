---
name: api-server unit suite pre-existing breakage
description: 70 failures across 10 api-server test files (as of 2026-07-20) unrelated to load; root causes and how to distinguish from your own regressions.
---
Rule: before blaming your diff for api-server test:unit failures, run the failing file solo and capture the real error behind asyncHandler 500s with a temporary express error middleware.

Known pre-existing failure classes (tracked in follow-up task "Fix broken server test suite"):
- Route tests set E2E_AUTH_BYPASS=1 but never send the `x-e2e-user-id` header — requireAuth falls through to Clerk getAuth, which throws "clerkMiddleware should be registered" → every request 500s (e.g. terrain-bundles.test.ts).
- Test files that vi.mock ../middlewares/rateLimit.js without exporting __resetRateLimitMemory crash in src/__tests__/setup.ts (zone-cache-* files).
- admin.test.ts expects error code `invalid_param`; validate middleware now returns `invalid_request`.

Status update (later 2026-07-20): baseline is now 9 failed files / 3 failed tests (NYSDEC_BATHY_FEATURE_SERVICE missing from terrain.js mocks in 6 files, auth-bypass 500-vs-401, rate-limit-isolation guard listing 8 offender files, admin invalid_param). Catalog-search keyword-coverage failures are fixed and no longer part of the baseline.

**Why:** these failures make test-standard/test-heavy always fail; without knowing they're pre-existing you'll burn time bisecting your own change.
**How to apply:** verify your touched surfaces solo (route tests + component tests) and use skip_validation_reason citing this until the suite is repaired.
