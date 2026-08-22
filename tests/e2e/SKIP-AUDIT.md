# E2E conditional-skip audit

Last audited: 2026-08-22. The static call-site baseline is **238**:
`node scripts/check-skip-count.mjs` finds 0 static unit skips and 238
conditional `test.skip(` sites under `tests/e2e/`. Runtime GitHub-runner skips
are measured separately in `runtime-skip-baseline.json`; they must never be
used to raise this source-level baseline.

Baseline updated 2026-08-22 to 238: `coordinate-search.spec.ts` added two
explicit FIND DATA visibility gates ("user is not signed in or app did not
load"), matching category 1 (auth bypass inactive / landing page shown).
These skips protect the coordinate-search flow from producing misleading
failures when the signed-in shell is unavailable.
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

4. **Sparse-fixture short-circuits** (9 sites)
   "survey.{tif,nc,laz,bag} fixture is sparse at res=64 — sparse-rejection
   path is covered by NMEA/GPX tests". Intentional de-duplication: the
   sparse-rejection behaviour is asserted once in the NMEA/GPX specs; format
   specs skip rather than re-assert on fixtures that trip the sparse gate.

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
