# E2E conditional-skip audit

Last audited: 2026-10-01. The static call-site baseline is **211**:
`node scripts/check-skip-count.mjs` parses test source and finds 0 static unit
skips and 211 executable conditional `test.skip()` calls under `tests/e2e/`.
Comments and strings do not count. Runtime GitHub-runner skips are measured
separately in `runtime-skip-baseline.json`; they must never be used to raise
this source-level baseline.

Baseline reduced 2026-10-01 from 239 to 211 after the verified test-harness
repairs removed obsolete conditional skips. The AST scan also excludes a
comment-only `test.skip()` reference in `pwa-offline.spec.ts`. The five PWA
offline canvas gates share one explicit auth-only skip; after the authenticated
shell is present, a missing canvas fails the test instead of skipping it.

The earlier 2026-09-30 standalone scanner correction measured 238 actual
calls before those test-harness repairs, including 15 PWA calls rather than
16 raw-text matches. The merged PWA spec now has 11 actual calls. Comments,
quoted strings, template text and regex literals do not count; executable
template interpolations do. Whitespace or comments between call tokens do
not conceal actual calls. The zero-static-unit baseline is unchanged.

Baseline reduced 2026-09-28 from 241 to 239: the real-upload offline-reload
check now asserts service-worker registration and page control instead of
skipping on either failure. Both are prerequisites for the offline behavior
under test, so a failure must remain visible.

Baseline updated 2026-09-28 to 241: the EFH water-type-switch browser
regression adds two explicit readiness gates. Missing `window.__bathyTest`
matches category 2 (dev helpers are absent outside the dev build); missing
`setActiveDatasetId` after the helper appears matches category 1 (the
authenticated shell/TestBridge did not mount). The test cannot seed its
catalog and terrain or switch water type through the bridge without these
preconditions. In the authenticated E2E fixture both gates should be false;
once ready, missing EFH controls or switch results are assertions, not skips.

Baseline updated 2026-09-27 to 239: `efh-overlay.spec.ts` waits for initial
server-settings and dataset-catalog hydration, resets collapsed panels, and
asserts that EFH controls render instead of skipping when they do not. The
pair-limit, pair-change, dataset-switch, polygon, and detail assertions now run
in the authenticated fixture.

Baseline updated 2026-08-22 to 238: `coordinate-search.spec.ts` added two
explicit FIND DATA visibility gates ("user is not signed in or app did not
load"), matching category 1 (auth bypass inactive / landing page shown).
These skips protect the coordinate-search flow from producing misleading
failures when the signed-in shell is unavailable.
Baseline updated 2026-09-07 to 241: `efh-overlay.spec.ts` added three
authenticated test-bridge/catalog gates (the EFH controls are not rendered
when the seeded dataset is unavailable), matching categories 1 and 2.
Baseline updated 2026-08-21 to 236: `pwa-offline.spec.ts` added the
"Service-worker readiness failure and retry" describe block with 2 new
environment-gated skips (error state not reached when the SW stub is not
installed — category 7; one additional MY LIBRARY / trigger gate moved into a
shared helper — category 1). Existing inline skip pairs were consolidated into
the `openLibraryTrigger` helper without adding net new sites.
Baseline updated 2026-08-18 to 234: `pwa-offline.spec.ts` added the
"Save Offline full-download flow" describe block with 6 environment-gated
skips (MY LIBRARY / trigger not rendered when auth bypass or app boot fails —
category 1; controlling service worker absent, offline-reload page close,
cold SW cache in the optional offline smoke check — categories 2 and 7).
Baseline updated 2026-08-13 to 216: `overview-puzzle-multiselect.spec.ts`
added 9 environment-gated skips (auth-bypass / canvas gate + test-bridge /
terrain gate), matching categories 1 and 2 below.
Baseline updated 2026-08-13 to 207: `overview-puzzle-rotation.spec.ts`
added 9 environment-gated skips (auth-bypass / canvas gate + test-bridge /
terrain gate), matching categories 1 and 2 below.
Baseline updated 2026-07-21 to 199: `manual-conditions-chip-mobile.spec.ts`
added one test-bridge/auth-bypass gate ("Test bridge not ready — app not
signed in"), matching the existing auth-bypass category below.

Every `test.skip(...)` call site in `tests/e2e/` was reviewed. All of them are
**conditional, environment-gated skips**: they only fire when a runtime
precondition is absent, and every one carries a descriptive message string
explaining the gate. None of them are unconditional dead tests.

## Skip categories (all confirmed intentional)

1. **Auth bypass inactive / landing page shown** (~60 sites)
   Messages like "Canvas not visible — landing page shown", "App not signed
   in". These specs require `VITE_DEV_AUTH_BYPASS`; when the bypass is not
   active the signed-in shell never mounts and interaction tests cannot run.
   Intentional: the same specs run fully in the standard e2e environment
   where the bypass is set.

2. **Test bridge / dev helpers missing** (~25 sites)
   "window.__bathyTest not installed", "seedTerrain returned false",
   "TestBridge not ready", "Test bridge lost after reload". The `__bathyTest`
   bridge is only registered by the dev build's Canvas hooks; headless or
   production-mode runs legitimately lack it (see memory: headless test-bridge
   fallback).

3. **Upload UI not available** (~20 sites)
   "Upload accordion or dropzone not visible in this environment". The upload
   accordion is gated on signed-in state + panel layout; same auth-bypass root
   cause as category 1, checked closer to the interaction point.

4. **Parser success fixtures** (0 skip sites)
   LAZ, GeoTIFF, and NetCDF success-path tests now require accepted responses
   from representative fixtures. A sparse or invalid fixture is a test failure,
   not a reason to skip parser success coverage.

5. **Headless-parse timeout guards** (4 sites)
   "TIFF/NetCDF/LAZ/BAG upload timed out after 75–90 s — server parse too
   slow in headless". Anti-flake guards: a slow parse is not a product
   failure; the parse itself is covered by unit tests.

6. **Optional-data panels** (~15 sites)
   Tide/Currents/Habitat/Zone-Analysis panels skip when their upstream data
   source is unavailable in the test environment ("tide data not loaded",
   "currents may not be enabled", "API unreachable").

7. **Environment flakes / hardware gates** (rare)
   "WebGL unavailable: Chromium GPU process unavailable", "Page closed during
   offline setup — environment flake", "GPS did not activate in headless
   environment". Hardware/browser capability gates.

## Prevention

`scripts/check-skip-count.mjs` (run as `check:skip-count` in the fast
validation tier) records source-level baseline counts in `tests/skip-baseline.json`:

- static `it.skip` / `test.skip` / `describe.skip` in unit tests (baseline 0), and
- `test.skip(` call sites in `tests/e2e/` (conditional gates).

The step fails with a pointed message when either count rises above its
baseline, so new silent skips surface immediately. When you intentionally add
a gated skip (with a message and a matching category above, or a new
documented category), update the baseline in the same commit.

This is not the GitHub runtime-skip ratchet. CI also captures the actual final
Playwright outcome and skip reasons, then compares its skipped count per
workflow suite against `tests/e2e/runtime-skip-baseline.json`. A clean lower
count is a prompt to lower that CI-specific baseline; it never justifies
raising this static call-site count.
