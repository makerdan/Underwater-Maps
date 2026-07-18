---
name: Plan-mode sidebar restructure breaks e2e assumptions
description: Classes of e2e failures caused by the Plan/Explore/Analyze sidebar tabs restructure and how to fix them
---

The "Plan mode sidebar" restructure moved panels into tabs (Explore/Plan/Analyze) with `display:none` for inactive tabs, breaking several e2e assumptions:

- WeatherPanel/Drift Planner now renders embedded in the **Plan** tab (no "⛵ DRIFT PLANNER" header, no × close button). Tests must click button "Plan" and assert `getByTestId("weather-panel")`; close via toggling "◉ DRIFT".
- `sidebarMode` persists **server-side** per user — an earlier spec that switched to Plan leaves the next spec loading in Plan mode. Tests asserting Explore-tab content must click "Explore" first.
- The Explore tab shows an empty-state ("Load a dataset to begin" + BROWSE DATASETS) until terrain loads; DatasetPanel/MY UPLOADS only renders after `__bathyTest.seedTerrain()`.
- OnboardingOverlay (zIndex 9000) intercepts clicks; seed `hasSeenOnboarding:true` in `bathyscan:settings` localStorage (see patchOnboardingSeen in shallow-dataset.spec.ts).

**Also:** `page.addInitScript()` returns a promise — an unawaited call races the following `goto()`, so the seed may not be installed on first load (intermittent). Always `await page.addInitScript(...)` before navigation. Init scripts DO re-run on `page.reload()`; for reload-persistence assertions rely on server hydrate (`__bathyTest.waitForServerSettingsSync()` before reload) rather than sessionStorage guards.

ContextMenu now re-clamps position against measured size in a useLayoutEffect (estimated ITEM_HEIGHT was stale after the ×1.5 font scaling).

As of July 18 2026 the full `pnpm run test:e2e` suite passes with 0 failures — all restructure fallout was fixed (MY UPLOADS visibility, dialog focus, help deep links, tide/timeline scrubbers, onboarding sync races). Note: this fallout was long masked because the test-heavy runner self-deadlocked before its full-e2e step ever ran.
Most of these classes were fixed in July 2026 (coord-search collapsed `<details>`, 9-item crosshair menu, seedTerrain + onboarding-suppression in upload/focus-trap specs, `sidebarMode:"explore"` in fixtures DEFAULT_SETTINGS, laz-perf.wasm copied by api-server build.mjs). Cross-spec leakage fix: server-persisted `sidebarMode` must be reset via the fixtures' DEFAULT_SETTINGS seed, not per-spec clicks.
