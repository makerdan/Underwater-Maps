---
name: Plan-mode sidebar restructure breaks e2e assumptions
description: Classes of e2e failures caused by the Plan/Explore/Analyze sidebar tabs restructure and how to fix them
---

The "Plan mode sidebar" restructure moved panels into tabs (Explore/Plan/Analyze) with `display:none` for inactive tabs, breaking several e2e assumptions:

- WeatherPanel/Drift Planner now renders embedded in the **Plan** tab (no "⛵ DRIFT PLANNER" header, no × close button). Tests must click button "Plan" and assert `getByTestId("weather-panel")`; close via toggling "◉ DRIFT".
- `sidebarMode` persists **server-side** per user — an earlier spec that switched to Plan leaves the next spec loading in Plan mode. Tests asserting Explore-tab content must click "Explore" first.
- The Explore tab shows an empty-state ("Load a dataset to begin" + BROWSE DATASETS) until terrain loads; DatasetPanel/MY UPLOADS only renders after `__bathyTest.seedTerrain()`.
- OnboardingOverlay (zIndex 9000) intercepts clicks; seed `hasSeenOnboarding:true` in `bathyscan:settings` localStorage (see patchOnboardingSeen in shallow-dataset.spec.ts).

**Also:** e2e `addInitScript` seeds re-run on `page.reload()` — guard with a sessionStorage flag or reload-persistence assertions get clobbered. Panel collapse "persists across reload" only via server hydrate; await `__bathyTest.waitForServerSettingsSync()` before reload.

ContextMenu now re-clamps position against measured size in a useLayoutEffect (estimated ITEM_HEIGHT was stale after the ×1.5 font scaling).

As of July 18 2026 the full `pnpm run test:e2e` suite passes with 0 failures — all restructure fallout was fixed (MY UPLOADS visibility, dialog focus, help deep links, tide/timeline scrubbers, onboarding sync races). Note: this fallout was long masked because the test-heavy runner self-deadlocked before its full-e2e step ever ran.
