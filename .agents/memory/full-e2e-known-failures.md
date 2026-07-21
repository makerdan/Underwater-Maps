---
name: Full e2e suite — 9 deterministic failures (July 2026)
description: Known failing specs in the full playwright run unrelated to chip/settings work; reproduce solo, likely upstream regression.
---

As of 2026-07-20 the full playwright run (e2e-repro) fails deterministically (both under load and solo, retries included) on 9 tests, with 234 passing:

- find-data-my-uploads: Find Data panel never closes after clicking Load (dataset-load pipeline signal missing)
- follow-handoff: "Follow mode paused" toast never appears on out-of-bounds
- gps-trail + live-mode (3 tests): trail recorder / live-mode UI never reaches expected state
- water-landmass-toggles (3 tests): TOPO badge / topography download never appears
- onboarding-tour overlay is flaky (passes on retry)

**Why:** browser console showed "State loaded from storage couldn't be migrated since no migrate function was provided" (panelCollapseStore had `version: 1` with no `migrate`) and settings PUT "Failed to fetch" bursts.

**Status (2026-07-21):** The panelCollapseStore now has a `migrate` function (see `artifacts/bathyscan/src/lib/panelCollapseStore.ts`). The 5 associated unit test failures (zoneSettingsTerrainSync, routes-documented, portsGuard, raster-routes, terrainMock) are all fixed and confirmed by test-standard passing (95/95 api-server, 3680/3680 bathyscan). The 4 dataset-load pipeline e2e specs need a full e2e run to confirm they now pass — see follow-up task #3120.

**Env skip note (2026-07-21):** zone-colour-watertype.spec skips at the "Zone Analysis panel not visible" gate (headless env — UI shell not rendered), so its Settings-page section never executes locally. RESOLVED: the Settings-page zone-colour flow is now covered headlessly (no skip gates) by tests/e2e/zone-colour-settings.spec.ts, which drives ZoneColourSwatches' useEffect([waterType]) wiring on /settings directly and passes solo (~4 s).
