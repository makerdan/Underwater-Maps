# Bug Audit — Recent Merge Regressions

**Date:** 2026-08-25  
**Mode:** report-only  
**Baseline:** `77f35eb36f9fb11c1c9e462dabeda2c1f59ce1c5` (`Add report-only BathyScan UX baseline sweep`)  
**Audited through:** `6927d33ef3e95154a64c412d66a641ab38d31153` (`Add test database schema column parity guard`)  
**Exact range:** `77f35eb3..6927d33e` (15 commits after the baseline report)  
**Scope:** Recent BathyScan sidebar/upload, geographic placement, puzzle/GPS persistence, marker-schema/test-DDL, and adjacent collection/API changes. This is not a historical full-codebase audit.

## Executive summary

One new, independently reproducible product defect was found in the audited
merge range. The highest-risk paths were inspected for security, data
integrity, null/undefined safety, asynchronous timing, state synchronization,
and user-visible error handling. Focused tests for the changed BathyScan and
test-database surfaces otherwise passed.

The audit did identify or reconcile the following non-product signals:

| Classification | Severity | Result |
|---|---:|---|
| Product defect | High | **1 confirmed** — puzzle geographic offset is not republished after a user zooms the Overview map. |
| Test/specification baseline | High signal risk | The known Overview puzzle browser contract failures remain from the prior audit; not introduced by this range and not reproduced as a new product defect here. |
| Test/environment limitation | Medium signal risk | The authenticated Playwright paths could not provide a failing browser state in this environment; skipped browser coverage is not counted as a pass. |
| Validation suite failure | — | The mandated `test-standard-plus` run completed in 321.5s with the pre-existing/unrelated failures classified below; the changed Overview regression was reproduced separately. |

No application, test, configuration, dependency, generated, or database files
were modified. The only tracked addition is this report. An unrelated
pre-existing untracked asset under `attached_assets/` was left untouched.

## Merge surfaces examined

### Commits and files

- `d9980857` — geographic placement across Overview and Minimap:
  `OverviewMap.tsx`, `Minimap.tsx`, and the shared geographic-frame behavior.
- `dc1e6bbe` through `4855dd65` — sidebar heading, tab, spacing, and layout
  changes:
  `App.tsx`, `SidebarSection.tsx`, `SidebarModeTabs.tsx`,
  `MySavesSection.tsx`, `index.css`, and help styling.
- `54bfe287` through `eac7d863` — upload-format tooltip and upload chooser
  interaction:
  `App.tsx` and `DatasetPanel.tsx`.
- `7704e095` — Find Data filter changes:
  `CatalogResultFilters.tsx`, `FindDataPanel.tsx`, and related focused tests.
- `6927d33e` — test database schema/type parity guard:
  `scripts/check-testdb-schema-drift.mjs`,
  `scripts/__tests__/check-testdb-schema-drift.test.mjs`, and the existing
  `lib/db/src/__tests__/test-db.ts` marker DDL.
- Adjacent API/schema surfaces reviewed:
  `artifacts/api-server/src/routes/markers.ts`,
  `artifacts/api-server/src/routes/collections.ts`,
  `lib/db/src/schema/markers.ts`, and
  `lib/api-spec/openapi.yaml`.
- Persistence and GPS surfaces reviewed:
  `artifacts/bathyscan/src/lib/puzzleRestore.ts`,
  `artifacts/bathyscan/src/lib/geographicBounds.ts`,
  `artifacts/bathyscan/src/components/OverviewMap.tsx`, and
  `artifacts/bathyscan/src/components/Minimap.tsx`.

### Existing reports and active work reconciled

- `docs/audits/ux-baseline-sweep-2026-08-24.md` remains the owner of the
  signed-in journey baseline and its manual browser queue.
- `docs/audits/bug-audit-preexisting-2026-08.md` remains the source of the
  known plan/archive, dependency, and Overview puzzle `toSatisfy` findings.
- The marker `expires_at` test-DDL failure recorded in the 2026-08-24 report
  is resolved by the merged schema-parity work and is not duplicated here.
- The active dataset inspection, signed-in journey, and test-database tasks
  were treated as visible baseline context only, not as completed evidence or
  duplicate findings.

## Findings

### F-1 — Overview puzzle geographic offsets stay stale after wheel zoom

- **Classification:** Confirmed product defect.
- **Severity:** High — puzzle tiles can be rendered at one geographic position
  while persisted/communicated GPS placement still represents the old map
  scale, causing inaccurate cross-device or follow-up placement.
- **Introducing change:** `d9980857`, `Fix geographic placement across
  Overview and Minimap`.
- **File/lines:** `artifacts/bathyscan/src/components/OverviewMap.tsx:2606-2630`
  (rAF republish path) and `:3345-3395` (mouse/wheel event surface).
- **Scenario:** Enter puzzle mode with a tile translated east by a fixed pixel
  offset, then zoom in on the Overview canvas. The same pixel offset covers
  fewer degrees at the larger scale, so `puzzleGeoTransforms[datasetId].dLon`
  must strictly decrease. Instead it remains unchanged.
- **Evidence:** The existing regression test
  `artifacts/bathyscan/src/__tests__/overviewMap.componentIntegration.test.ts:1904-1939`
  failed deterministically **3/3** in isolation:
  `dLonBefore === dLonAfter === 0.16645951704543904`. The rAF code is intended
  to use `viewKey` changes at `OverviewMap.tsx:2597-2613`, but the real wheel
  path does not result in a changed published transform in this scenario.
- **Recommended fix:** Trace the wheel handler through `transformRef.current`,
  `dirtyRef`, and the rAF loop; ensure wheel zoom updates the same transform
  object/view key consumed by the geographic republish branch, and add a
  browser- or component-level assertion that a fixed-pixel puzzle translation
  changes in degrees after zoom. Preserve wrapped-longitude normalization while
  fixing the refresh trigger.
- **Dependencies:** None identified. This should be fixed before relying on
  puzzle geographic persistence or cross-device placement verification.

### No other confirmed product findings

No finding meets the audit threshold of a reproducible user-visible failure
or a deterministic code-level data/security defect introduced in the audited
range. In particular:

- **Security:** Every marker read/write/delete route remains behind
  `requireAuth` (`artifacts/api-server/src/routes/markers.ts:167-395`), and
  every collection mutation and background/layout route inspected remains
  behind `requireAuth` (`artifacts/api-server/src/routes/collections.ts:314-840`).
  No new unauthenticated mutation path was found.
- **Marker persistence:** The production marker schema declares
  `expires_at` (`lib/db/src/schema/markers.ts:25-30`) and the hand-written
  test DDL now includes it (`lib/db/src/__tests__/test-db.ts:182-197`).
  The parity checker reports all mirrored columns and unique indexes in sync.
- **Upload chooser timing:** The header increments `uploadRequest` once per
  explicit click (`artifacts/bathyscan/src/App.tsx:1540-1570`). The dropzone
  consumes each request once before opening the native picker
  (`artifacts/bathyscan/src/components/DatasetPanel.tsx:2917-2932`), and
  disables the chooser while an upload is busy. The focused DatasetPanel tests
  passed.
- **Geographic placement:** Overview and Minimap now use the shared circular
  longitude operations for union bounds, hit tests, GPS eligibility, and
  camera-arrow projection. The focused geographic and Minimap tests passed;
  F-1 is the separate stale puzzle-transform publication exception.
- **Puzzle restore:** The restore builder creates the canvas transform map,
  group map, and store mirror from the same restored objects while filtering
  unloaded members (`artifacts/bathyscan/src/lib/puzzleRestore.ts:49-87`).
  The implementation and existing restore tests were reviewed; the focused
  command below did not include the `src/lib/__tests__` paths.

## Test, tooling, and environment classifications

### T-1 — Known Overview puzzle browser contract baseline (not new)

- **Classification:** Test/specification baseline; not a product defect.
- **Severity:** High test-signal risk.
- **File/lines:** `tests/e2e/overview-puzzle-multiselect.spec.ts` — the
  previously documented session-hydration and Reset-button expectations.
- **Scenario:** The browser spec can fail while the puzzle interaction is
  usable, or fail to validate persistence/reset behavior, masking a future
  regression.
- **Evidence:** `docs/audits/ux-baseline-sweep-2026-08-24.md:65-83` and
  `docs/audits/bug-audit-preexisting-2026-08.md:36-41` document the failures
  before this range. The audited merge range does not change that spec.
- **Recommendation:** Align the browser expectations with the intended
  product contract (or deliberately change the product contract), then run
  the isolated spec three times before restoring it to the palette suite.
  This report does not change the spec.

### T-4 — Sidebar and upload-adjacent unit contracts are stale (not product findings)

- **Classification:** Test-only baseline/contract drift.
- **Severity:** Medium test-signal risk.
- **Evidence:** The full run and three isolated retries consistently failed
  `DatasetPanel.myLibraryCollapse.test.tsx:356-381` because the current
  `SidebarSection` intentionally renders `▾`/`▸` while the test still expects
  `▲`/`▾`; the implementation is at
  `artifacts/bathyscan/src/components/SidebarSection.tsx:125-143`.
  The same run and three isolated retries failed
  `sidebarShell.responsiveMinWidth.test.tsx:114-129` because the current
  merge explicitly uses `2.25in`, yielding `min(736px, -32px + 100vw)`, while
  the test expects the former `2in`/`712px` contract. The implementation is at
  `SidebarSection.tsx:191-198`.
- **Scenario:** Full unit validation reports red even though the visible
  behavior matches the newer sidebar changes; future regressions in these
  areas can be hidden by treating the stale assertions as product failures.
- **Recommendation:** Update those assertions in a separate approved test
  maintenance task, or explicitly revert the UI contract if the old chevrons
  and width are still required. Do not count this as evidence against the
  upload chooser change.

### T-5 — Unrelated pre-existing unit and migration failures

- **Classification:** Pre-existing/baseline or unrelated test/tooling failure.
- **Severity:** No product severity for this audit.
- **Evidence:** `settingsBackup.test.ts:122` consistently reports the
  unrelated `dailyRouteTimezone` skipped-key contract; the two
  `useOfflinePackStatus.test.ts` failures consistently report `stale` versus
  `downloaded`; and `accessibility.audit.test.tsx` cannot render
  `GpsImportDialog` without a Clerk provider (`GpsImportDialog.tsx:155`).
  These files were last changed before the audited range. The full run also
  reports the existing schema-stale guard for migration
  `0026_add_marker_expiry` without `meta/0026_snapshot.json`; the marker
  column parity guard itself passes.
- **Recommendation:** Track these through their owning test/schema work,
  not through the merge-regression fix for F-1. No implementation files were
  changed during this audit.

### T-6 — Settings cross-device E2E timeout (owned by active sync work)

- **Classification:** Test/manual-flow failure; not independently classified
  as a new product defect in this audit.
- **Severity:** Medium test-signal risk.
- **Evidence:** Completion validation's palette E2E run reached 18 passing
  tests and 11 skipped tests, with one retryable failure in
  `tests/e2e/settings-cross-device-sync.spec.ts:126`: a locator click timed
  out after 60 seconds in both the initial attempt and retry. The test
  ran with the E2E auth bypass and the browser artifact included an error
  context, but no screenshot-backed user-visible failure was established.
- **Scenario:** The settings sync flow may be blocked by an overlay, hydration
  state, or selector timing, but the test timeout alone does not distinguish
  those from harness timing.
- **Recommendation:** Leave this with active task 4537, “Repair settings sync
  Palette E2E baseline,” which already owns the overlapping flow. Reproduce
  there with the existing trace/error context before opening any new task.

### T-2 — Authenticated browser evidence unavailable (manual follow-up)

- **Classification:** Test/environment limitation; not a product defect.
- **Severity:** Medium test-signal risk.
- **Scenario:** A sidebar, upload, GPS, or puzzle regression that occurs only
  after authentication or terrain seeding can remain unconfirmed when the
  harness skips rather than exercising the journey.
- **Evidence:** The prior baseline records the E2E auth-bypass/seeded-terrain
  limitation (`docs/audits/ux-baseline-sweep-2026-08-24.md:103-130`).
  No failing browser screenshot exists because no failing browser state was
  reached; skipped tests are not treated as passes.
- **Recommendation:** Use the existing authenticated desktop and mobile
  harness to exercise the manual queue, especially upload chooser open/drop,
  Overview GPS eligibility, and puzzle reload/reset. Capture screenshots only
  if a reproducible failure is found.

### T-3 — Mandated validation workflow exposed baseline failures

- **Classification:** Validation result with pre-existing/unrelated failures;
  not additional evidence beyond F-1.
- **Severity:** No product severity.
- **Scenario:** A completion check could rely on a stale or incomplete log
  instead of knowing whether all standard-plus steps completed.
- **Evidence:** The exact mandated `test-standard-plus` workflow completed on
  2026-08-25 in 321.5 seconds. Typecheck, lint, production build, audit,
  schema-column parity, and the other static guards passed. The BathyScan unit
  shard reported 446 passing files / 5,856 passing tests and 6 failed files /
  10 failed tests; F-1 is one of those failures. The other failures are
  catalogued as T-4/T-5. The migration snapshot guard also reported the
  pre-existing missing `meta/0026_snapshot.json`.
- **Recommendation:** Keep F-1 as the only confirmed product regression from
  this run. Resolve the owning test/schema baselines separately and rerun the
  registered validation command after F-1 is fixed. No validation
  infrastructure was changed here.

## Focused evidence

### BathyScan changed-surface run

Command:

```text
pnpm --filter @workspace/bathyscan exec vitest run \
  src/__tests__/geoFrame.test.ts \
  src/__tests__/Minimap.test.tsx \
  src/__tests__/followBoundsCheck.test.ts \
  src/__tests__/DatasetPanel.test.tsx \
  src/__tests__/OverviewMap.responsiveInteractions.test.tsx \
  src/__tests__/puzzleRestore.test.ts
```

Result: **4 test files passed, 69 tests passed**. The requested
  `followBoundsCheck` and `puzzleRestore` live under `src/lib/__tests__`, not
  the `src/__tests__` paths supplied to this command, so Vitest executed the
  four available matching files. The run emitted known non-failing
  test-environment warnings for IndexedDB, mocked AbortSignal, and React
  `act()` handling.

### Test-database parity run

Commands:

```text
node scripts/check-testdb-schema-drift.mjs
node --test scripts/__tests__/check-testdb-schema-drift.test.mjs
```

Result: production scan reported **75 columns and 5 unique-index
declarations** in sync; the self-test reported **13 tests passed, 0 failed**.

### Static review categories

| Category | Result |
|---|---|
| Null/undefined safety | No new unguarded access verified in the changed paths. |
| Async/timing | Upload request de-duplication and Overview imperative refs were traced; no deterministic stale-closure or cleanup defect verified. |
| Error handling | Existing upload, Overview retry, marker, and collection error paths remain present; no newly silent failure verified. |
| Type safety | Focused TypeScript/React paths exercised by the tests passed; no new runtime shape mismatch verified. |
| State/data integrity | Marker DDL parity passed focused checks; F-1 is a verified stale geographic-transform publication path. |
| Security | Marker and collection mutations retain authentication and rate-limit middleware. |
| Performance | No new unbounded render/network loop verified in the merge surfaces. |
| Concurrency/shared state | Upload chooser requests are consumed once; no reproducible overwrite race found. |
| Dead/unreachable code | No new dead branch was established as a defect. |
| Dependency hygiene | No dependency changes occurred in the audited range. |

## Browser screenshots

**None added.** No browser-visible candidate reached a reproducible failing
state, and the available authenticated harness was not able to provide a
valid failure state. Capturing a normal screenshot would not substantiate a
regression; existing screenshot conventions were therefore not expanded.

## Recommended order

1. Fix F-1 and add the zoom-to-geographic-offset regression assertion before
   relying on puzzle geographic persistence.
2. Restore the authenticated desktop/mobile browser harness and run the
   existing manual queue; classify only reproducible user-visible failures.
3. Align and stabilize the known Overview puzzle browser contract, then run
   that spec three times in isolation before reintegrating it.
4. Repair the settings E2E baseline through active task 4537, then re-run
   the palette suite.
5. Re-run `test-standard-plus` after F-1 and the accepted test-contract work.
6. If any of those steps produces a concrete product failure, open one
   screenshot-backed fix task per finding. No product fix task is justified by
   this report alone.

## Report-only boundary

This audit intentionally stops at triage. No product, test, configuration,
dependency, generated, or validation files were changed.