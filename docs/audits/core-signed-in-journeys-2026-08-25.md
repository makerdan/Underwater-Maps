# Core signed-in journey confirmation

**Date:** 2026-08-24  
**Scope:** BathyScan authenticated browser flows at desktop and mobile
breakpoints.  
**Method:** Playwright with the development auth bypass, isolated API/web
ports, and the repository's existing seeded-terrain/test-bridge helpers.

## Desktop results

| Journey | Result | Evidence |
| --- | --- | --- |
| Fresh onboarding and navigation | **Environment limitation / partial pass** | `tests/e2e/onboarding-tour.spec.ts`: 2 passed, 7 skipped. The Settings replay path passed; first-load overlay, Skip, Done, Find Data, demo, and Help-tour paths could not mount because the terrain-gated onboarding overlay was absent. |
| Dataset search / My Uploads | **Reproducible user-facing failure** | `tests/e2e/find-data-my-uploads.spec.ts`: 1 failed (including retry). The authenticated app and Find Data entry point loaded, but the expected `My Saves` button was absent at line 161. |
| Upload / persistence | **Reproducible user-facing failure** | `tests/e2e/dataset-upload-autosave.spec.ts`: the real upload API returned and the library showed the uploaded dataset, but the expected `btn-user-dataset-*` control never appeared; the UI upload path likewise timed out while waiting for the matching row. |
| Upload retry / cancel | **Not confirmed** | The upload suite did not reach a clean completion because the dataset-row failure stopped the run before these behaviors could be declared release-ready. |
| Overview loading / interaction | **Partial pass with reproducible failure** | `tests/e2e/overview-map.spec.ts`: opening the Overview dialog, canvas teleport, and Escape dismissal passed; the `✕ CLOSE` control was visible in the captured dialog tree but Playwright could not locate it at the assertion, failing twice. |
| GPS / follow / trail | **Reproducible user-facing failure** | `tests/e2e/live-mode.spec.ts`: 3 passed, 4 failed. Plan/live navigation and GPS activation passed in the broader core run, but Live trail indicator/status/interval controls were absent, so recording/follow/trail assertions failed. |
| Planning | **Pass** | `tests/e2e/drift-planner.spec.ts`: START PLANNING, conditions panel, time chips, and STOP PLANNING all passed. |
| Markers | **Pass** | `tests/e2e/marker-flow-real.spec.ts`: auth-gated marker creation, retrieval, deletion, cache invalidation, and Escape behavior passed. |
| Settings sync | **Pass with cleanup defect** | `tests/e2e/settings-cross-device-sync.spec.ts`: settings were saved, Last Synced populated, local storage cleared, and the server value restored on reload. Cleanup failed because the transient `Settings synced` toast intercepted `confirm-reset-all-btn`. |
| Offline recovery | **Pass for available prerequisites** | `tests/e2e/pwa-offline.spec.ts`: 10 passed, 6 skipped. Manifest/meta/icon, cache management, offline failure/retry, storage inspection, and cached reload passed. Canvas/network-abort checks skipped where terrain/SW prerequisites were unavailable. |

## Mobile result

| Journey | Result | Evidence |
| --- | --- | --- |
| Authenticated onboarding/settings at Pixel 7 viewport | **Environment limitation** | A temporary Playwright config using `devices["Pixel 7"]` could start the API and web servers, but the host Chromium repeatedly crashed its GPU/V8 process (`GPU process isn't usable`, `Error loading V8 startup snapshot file`) before stable browser contexts could complete. The mobile run ended with 9 browser-context failures and 1 setup pass; no product assertion is classified from this run. |

## Run commands

```text
E2E_WEB_PORT=3250 E2E_API_PORT=3261 ... playwright test find-data-my-uploads.spec.ts
E2E_WEB_PORT=3252 E2E_API_PORT=3263 ... playwright test live-mode.spec.ts
E2E_WEB_PORT=3254 E2E_API_PORT=3265 ... playwright test pwa-offline.spec.ts
E2E_WEB_PORT=3258 E2E_API_PORT=3269 ... playwright test overview-map.spec.ts drift-planner.spec.ts marker-flow-real.spec.ts gps-trail.spec.ts dataset-upload-autosave.spec.ts
```

All runs used `TASK_PLAN_FILE=.local/tasks/task-4525.md`,
`VITE_DEV_AUTH_BYPASS=1`/`E2E_AUTH_BYPASS=1` through the repository config, and
unique `E2E_RUN_SUFFIX` values. The API health probe returned 200 on each clean
startup. The initial combined run was stopped by the five-minute shell watchdog;
each affected area was then rerun independently or on isolated ports.

## Release assessment

The authenticated bypass and API are operational, and planning, markers,
settings round-trip, and available offline behavior are confirmed. The release
gate is **not clear** for dataset browsing/upload UI, Live GPS trail controls,
the Overview close action, or the settings-reset cleanup path. Mobile remains
unverified until a Chromium environment with a stable GPU/V8 process is
available.