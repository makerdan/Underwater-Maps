# BathyScan Terrain Data UX/E2E Audit

**Date:** 2026-08-22  
**Mode:** **Report-only contribution.** The audit contribution is this report;
it did not author application-source, test, fixture, task-plan, or
validation-configuration changes. While the audit was in progress, other
assigned tasks merged XML-upload, GCS polling-auth, catalog-filtering, and
copyable-error changes into the shared branch. Those concurrent changes are
not treated as audit interventions or as evidence that this report modified
the prescribed product workflows.
**Scope:** Finding terrain data; saving, uploading, loading, exporting,
organising, and taking terrain data offline in `artifacts/bathyscan` and
`artifacts/api-server`.

## Executive summary

The terrain-data workflow has meaningful real-server coverage for bundled
presets, a small CSV upload, folder APIs, terrain-download auth/preflight, and
several upload parser rejection paths. The required browser suite also exposed
that a large amount of apparent coverage is deliberately limited: catalog-save
rename and folder UI tests intercept routes, upload fixtures are tiny or
intentionally sparse, several upload happy paths are skipped, and offline-pack
tests use a service-worker stub rather than a persisted pack followed by a
real offline reload.

**Shared-branch provenance:** The working tree was clean before this report was
written. Completion tooling may show the concurrent feature commits in the
same comparison range as this report because all task agents share the branch;
they belong to their own assigned tasks and must not be removed or folded into
this report-only audit.

One user-visible issue is confirmed, but it is not newly filed here:

1. **Medium:** dragging a dataset or catalog save into a folder is a known
   broken interaction. This is already being addressed by active Task #4399,
   “Restore Dataset Folder Dragging.”

The audit did **not** classify an unavailable external bathymetry source as an
application regression. The terrain-download contract intentionally permits
an authenticated download request to return `502` when its upstream provider
is unavailable.

## Evidence vocabulary

| Label | Meaning |
|---|---|
| **Real browser/API/storage** | Browser and/or API used the running app, real route implementation, and where applicable the test database. It is not automatically proof of a real device or external provider. |
| **Route-mocked** | Playwright intercepted an app route and supplied a fixture. It proves UI branching only. |
| **Synthetic** | A generated small grid, tiny format fixture, dispatched browser event, or test bridge supplied the precondition. |
| **`__bathyTest`** | Test-only browser bridge used to seed or observe terrain. It is useful observation evidence, not a normal user path. |
| **Skipped** | A test intentionally declined to make a claim in this environment. |
| **Manual QA required** | The automated environment cannot provide trustworthy evidence for this behavior. |

`PASS` means the named journey has evidence at the stated boundary; it does
not imply unlisted variants are proven. `FAIL` is a confirmed user-facing
failure. `BLOCKED` means the intended journey cannot be concluded from the
current harness. `NOT TESTED` means no credible automated evidence exists.

## Environment and validation baseline

### Required validation command

The prescribed registered command was run through the durable validation
runner:

```text
test-heavy
node scripts/validation-lock.mjs -- node scripts/run-with-timeout.mjs aggregate -- node scripts/run-tier.mjs full --allow-no-plan
```

**Result:** `FAILED`, exit code `1`, duration **338,065 ms** (5m38s). Full log:
`.local/state/workflow-logs/PLUIlxJ0ZkQ4GJgs2LeGW/validation.shell.exec.0`.

The full E2E portion completed. Its terrain-specific named results are used in
this report; terrain download, offline/PWA, upload, and folder scenarios did
not appear in the E2E failure list. The overall suite failure included the
documented full-E2E baseline:

- `find-data-my-uploads.spec.ts`;
- `follow-handoff.spec.ts`, `gps-trail.spec.ts`, and `live-mode.spec.ts`;
- three TOPO badge/download expectations in `water-landmass-toggles.spec.ts`.

Those are excluded by this task's pre-existing-failure rule. In particular,
the Find Data test fails at the stale “My Saves” tab expectation, while the
current product locates My Saves in the left-side library.

The palette subset additionally failed settings cross-device reset and reported
the onboarding replay scenario as flaky. They are outside the terrain-data
scope and no code changed in this task. The two specs were retried together:
the settings-reset timeout and onboarding replay absence recurred on retries
one and two; retry three recorded the onboarding failure before the
five-minute shell execution limit stopped the command. These are recorded as
unrelated validation noise, **not** terrain findings and not evidence of a
change made by this report-only task.

The plan's known unit, puzzle, and plan-archive baselines were not investigated
or attributed to the audit. No validation fix was attempted.

## Journey evidence matrix

| Journey | Outcome | Evidence and boundary | Notes / remaining gap |
|---|---|---|---|
| Local catalog search | **PASS** | Real API implementation plus included unit coverage for catalog search parameters. | A live upstream catalog availability result was not used as a product-health assertion. |
| NCEI and federated discovery | **NOT TESTED** | Federated hooks have mocked/unit evidence; no dedicated real-browser, real-upstream federated search journey was found. | Network failures are rendered as an empty external-results state; real provider behavior remains manual QA. |
| Save a catalog item, materialise it, and load it | **BLOCKED** | Server route tests cover save/status/retry contracts, but there is no live browser save→processing/ready→load test. The current left-library callback does hand a ready save to the DatasetPanel loader. | No real materialisation/storage/browser proof; the older Find Data load-handler task describes a panel architecture that is no longer present. |
| My Saves browse, rename, refresh, and load | **BLOCKED** | `catalog-save-rename.spec.ts` passes with `GET /api/datasets/my-saves*` and rename routes intercepted. `find-data-my-uploads.spec.ts` fails on a stale My Saves tab assumption. | No real DB/storage/materialized-terrain browser proof. |
| Bundled preset load and loading dial | **PASS** | Real browser + real `/api/datasets` terrain path. `terrain-visibility.spec.ts` verifies a non-flat geometry/readout with `__bathyTest.probeTerrainGeometry`; `dataset-loading-dial.spec.ts` is skipped when the picker is unavailable. | Stronger than a route mock, but the geometry observation still uses the test bridge. |
| Direct small CSV upload, autosave, reload, and load | **PASS** | `dataset-upload-autosave.spec.ts` passes its real API/test-DB CSV success path: the saved row survives reload and is clickable. | The browser-drop and save-error cases were skipped; the CSV is a synthetic 12×12 grid. |
| LAZ and BAG upload happy paths | **NOT TESTED** | Specs use real parser/API code when able, but all listed LAZ/BAG happy-path browser/API cases were skipped in this run because the tiny fixtures can be sparse or environment-dependent. | Corrupt BAG rejection is covered by real server behavior, not a successful user journey. |
| NMEA and GPX upload error feedback | **PASS** | Real API tests passed for intentionally sparse NMEA/GPX inputs returning `422` and coverage data. | Dense successful NMEA/GPX import is not covered; bare terrain `.xml` is not an accepted terrain format—`text/xml` maps to GPX only. |
| Chunked upload, visible polling, retry, and before-unload warning | **NOT TESTED** | The scenarios are designed to use a real server after an injected failed chunk, but the suite marked them skipped in this run. | No proof here of a real restart recovery, session-resume banner, or GCS (>50 MiB) polling path. |
| Uploaded terrain overview/load handoff | **PASS** | The small CSV test uses the real saved-user-dataset path and checks no load error after selection. | Find Data’s My Uploads presentation uses route-mocked terrain/overview/user-dataset responses, so it does not add real proof. |
| Terrain CSV download auth and preflight | **PASS** | Real API tests passed: unauthenticated info/download return `401`; authenticated preflight returns expected shape; download is `200` CSV or allowed `502` upstream failure. | `502` is an external-source limitation, not an auth/UI failure. |
| Overview download mode, selection, auth warning, close/cancel | **PASS** | Browser tests passed normal pointer drawing, mutually exclusive tool state, popover structure, signed-out warning, cancel, and close. The setup seeds terrain and opens Overview with `__bathyTest`. | Correct viewport interaction is shown, but the terrain precondition is synthetic. |
| Downloaded CSV filename and contents | **NOT TESTED** | The real download-event test was skipped after no event arrived within its environment allowance. It only asserts a `bathyscan_*.csv` suggested filename if it runs; it does not parse contents. | Manual downloaded-file verification is required. |
| Single and bulk offline-pack states | **PASS (limited)** | `pwa-offline.spec.ts` passes manifest, offline badge, cache-management, and network-abort UI checks. Offline-pack tests exercise modal state/retry through a service-worker stub and mocked My Saves data. | This is not evidence that a pack persists in Cache Storage/IndexedDB or survives a real offline reload. |
| Offline use of a saved pack after reload | **NOT TESTED** | No real service worker, persisted custom dataset pack, offline reload, and terrain load chain was exercised. UUID-specific authenticated pack fetches are not covered by the synthetic IDs in the current tests. | Manual QA required; see limitations. |
| Folder create/rename/nest/delete/persist/ownership | **PASS** | `dataset-folders.spec.ts` uses the real API and test database for create, rename, nesting, duplicate, promote-delete, ownership, and fresh-request-context persistence. | This does not prove the visual library interaction. |
| Folder UI move dialog / bulk move | **PASS (limited)** | Browser action-bar tests pass with route-mocked folder, dataset, and move responses. | UI layout behavior only; no real storage or mutation proof. |
| Dataset/card drag into folder | **FAIL** | No trustworthy real drag test exists, and Task #4399 is actively restoring the broken user gesture. | See TD-02; keyboard/touch must retain the dialog fallback. |

## Confirmed findings

### TD-01 — Dragging datasets into folders is unavailable

**Severity:** Medium  
**Status:** Already tracked by active Task #4399, “Restore Dataset Folder
Dragging.”

**User impact:** Library users cannot use the expected drag-and-drop
organisation gesture for uploads or catalog saves. They must discover and use
the dialog-based move alternative, which is a poor substitute for pointer
users and does not help touch users unless that fallback remains discoverable.

**Reproduction:**

1. Open the left-side library with an uploaded dataset or a catalog save.
2. Attempt to drag it over a folder and drop it.
3. The expected regrouping/move does not complete.

**Evidence:** The active task is explicitly scoped to restoring the gesture.
Current `dataset-folders.spec.ts` verifies folder APIs against the real test
database, but its UI move scenarios intercept every folder/dataset/move route
and no current browser test performs a real drag. Therefore the reported
failure is not masked as a passing UI workflow.

**Likely owner:** My Library / folder interaction UI.  
**Related work:** Task #4399 and
`.local/tasks/restore-dataset-folder-dragging.md`.

## Important coverage limitations and follow-up evidence needs

These are not presented as product failures because the audit did not reproduce
them in a real user session.

1. **Catalog and federated sources:** There is no real browser flow that
   searches a federated provider, saves an importable result, observes queued →
   processing → ready/failed, retries, reloads, and loads its materialised
   terrain. The rename test is route-mocked. The older
   `.local/tasks/fix-catalog-save-load.md` should be revalidated against the
   current panel architecture before it is scheduled as a product fix.
2. **Uploads:** Successful LAZ/BAG paths and all chunked scenarios were skipped
   in this run. GCS uploads, restart recovery, the session-storage interrupted
   upload banner, dense successful NMEA/GPX files, and bare XML terrain import
   have no credible E2E proof.
3. **Upload error guard:** Several specs use a negative expectation for an
   `upload-save-error` test id that is absent from the current component tree.
   That assertion can pass vacuously, so it does not prove that a save failure
   would be visibly surfaced.
4. **Offline packs:** Current service-worker tests are stubbed and use
   non-UUID synthetic IDs. They do not exercise the authenticated custom-user
   dataset branch, Cache Storage/IndexedDB persistence, a controlled service
   worker, or an offline reload that renders the saved terrain. Static review
   also found that the offline path uses the generic UUID terrain endpoint;
   it works with a real Clerk token but lacks the user-route's legacy-data
   normalization and payload-size guard. Treat that as a production-risk
   investigation, not a confirmed user failure, until tested against a real
   legacy/large upload.
5. **Downloads:** The API and interactive preflight are covered, but the real
   download event was skipped and no test reads the CSV file. Filename/content,
   server error/retry, and external-upstream behavior need an environment with
   a reachable provider and download storage.

## Cross-cutting UX safeguards

| Safeguard | Audit result | Evidence / manual requirement |
|---|---|---|
| Accessible names and modal focus | **Partial** | Dialog roles, labels, Escape behavior, and dismiss controls exist in several data components. A screen-reader and keyboard traversal of every upload/offline/folder state was not automated. |
| Missing auth / signed out | **PASS (limited)** | Terrain download has real API `401` tests and a `__bathyTest` signed-out UI state. Real Clerk session expiry during save/upload/offline flows was not exercised. |
| Duplicate submit and stale loading cleanup | **Partial** | Chunked and pack code contains cancellation/retry handling, but skipped upload paths and mocked service workers prevent a user-flow conclusion. |
| Error copyability | **Partial** | Task #4397 completed copyable errors during this audit. Re-checking every terrain error surface is manual QA, especially parser, upstream, and service-worker errors. |
| Responsive/mobile and touch reachability | **Manual QA required** | Prior `ux-audit-mobile-report.md` already records fixed-width modal/drawer and safe-area risks. Browser automation here does not validate real touch drag, viewport keyboard occlusion, or small-device focus order. |
| Persistence after refresh | **Partial** | Real CSV autosave and folder API fresh-context persistence pass. Catalog materialisation, UI folder moves, packs, and interrupted uploads require the missing end-to-end proofs above. |

## Manual QA checklist

Run these checks on a signed-in physical or emulated mobile device and a desktop
browser with DevTools storage inspection:

- Search local, NCEI, and at least one federated source; record the external
  provider state separately from BathyScan UI failures.
- Save an importable item; observe each materialisation state, retry a failed
  state where offered, refresh, then load the ready item.
- Upload representative production CSV, LAZ, BAG, NMEA/GPX, and a chunked/GCS
  file. Interrupt network and reload during upload; verify the recovery action
  and non-duplicated error/progress states.
- Use Overview’s download tool with normal pointer input. Verify preflight
  source, area, resolution, cancel/close, an upstream error/retry, browser
  filename, and parsed CSV contents.
- Save one user upload and multiple library entries offline. Inspect the named
  Cache Storage entry and IndexedDB, reload with the network disabled, and
  load each saved terrain successfully.
- Create, rename, nest, move, and delete folders from both library contexts;
  test mouse drag, touch reachability, keyboard dialog fallback, error
  recovery, and refresh persistence.

## Report-only completion

This document is the audit deliverable. Proposed remediation belongs to the
existing folder-drag work cited above, plus future coverage-focused work; no
product or test-harness fix was made as part of this task.