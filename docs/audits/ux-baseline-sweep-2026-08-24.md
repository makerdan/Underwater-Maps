# BathyScan UX Baseline Sweep

**Date:** 2026-08-24  
**Mode:** report-only  
**Scope:** Core signed-in BathyScan journeys at desktop and mobile breakpoints. This is a baseline sweep, not a full panel-by-panel audit. No application, configuration, test, or dependency files were changed.

## Executive summary

The current tree has no newly verified product UX defect from the scoped unit
coverage. The two known OverviewMap signals remain useful baseline context, but
they are test/specification failures already assigned elsewhere and are not
attributed to this report:

1. The responsive-interactions baseline is owned by the active OverviewMap
   remediation task. The current branch includes the test typecheck restoration;
   the isolated responsive test file passed in the scoped run below.
2. The Overview puzzle multiselect browser spec still has the known
   session-hydration and Reset-button expectation failures. These are a
   test/app-contract mismatch and deterministic browser baseline failures, not
   evidence that the underlying puzzle interaction is broken.

The remaining limitation is authenticated browser confirmation. The existing
Playwright specs intentionally skip when the E2E auth bypass or seeded terrain
is unavailable, so browser-only findings are listed as manual follow-up rather
than being presented as confirmed defects.

## Baseline and evidence

- Reviewed `docs/audits/bug-audit-preexisting-2026-08.md` and
  `.agents/memory/unit-tier-baseline-2026-08.md` before assessing new signals.
- Current HEAD: `70e0ecd0` (`Restore Overview Map responsive test
  typechecks`); the worktree was clean before this report was added.
- Scoped isolated BathyScan unit run:

  ```
  pnpm --filter @workspace/bathyscan exec vitest run \
    src/__tests__/OverviewMap.responsiveInteractions.test.tsx \
    src/__tests__/OverviewMap.errorState.test.tsx \
    src/__tests__/FindDataPanel.nceiSaveError.test.tsx \
    src/__tests__/FindDataPanel.offlineCancel.test.tsx \
    src/__tests__/MySavesSection.test.tsx \
    src/__tests__/mobileChartShell.test.tsx \
    src/__tests__/settingsSyncToast.test.ts \
    src/__tests__/SettingsShellSync.test.tsx
  ```

  Result: **8 test files passed, 105 tests passed**. The run emitted expected
  test-environment warnings (mocked AbortSignal/upscale fallback and React
  `act()` warnings); none caused a test failure.

## Journey coverage

| Journey | Desktop | Mobile/differing path | Evidence and result |
|---|---|---|---|
| Entry, auth gate, onboarding, navigation | Code review; Playwright coverage reviewed | Mobile intentionally uses the chart shell and skips the desktop tour | Settings/onboarding guards wait for settings hydration; no new defect confirmed. Authenticated browser confirmation remains manual in this environment. |
| Find Data, catalog search, NCEI, loading/error/empty states | Component and e2e coverage reviewed | Full-height mobile drawer, backdrop dismissal, 44px close target | NCEI save error, offline cancellation, null-bbox, filtering, and water-type unit coverage passed. No new defect confirmed. |
| Uploads, My Saves, rename/delete/retry/offline | Component and e2e coverage reviewed | Responsive library controls and dialogs reviewed | My Saves unit suite passed; delete confirmations, rename validation, retry, empty state, and offline controls are represented. No new defect confirmed. |
| Explore and Overview map | Responsive, error-state, renderer, puzzle, and e2e coverage reviewed | Pointer streams, resize, and mobile-sized canvas path reviewed | Responsive and error-state unit tests passed in isolation. Known browser puzzle baseline is recorded below. No new product defect confirmed. |
| GPS/live/follow/trail | Live/GPS/follow/trail code and unit/e2e coverage reviewed | Mobile follow is the 2D chart path; desktop uses the 3D scene | Retry/recovery, out-of-bounds depth, follow pause/resume, and trail placement have coverage. Browser GPS hardware behavior requires manual confirmation. |
| Planning, markers, catches, imports | Drift, marker, catch, import, and escape/close coverage reviewed | Mobile plan tab is a separate shell | Existing unit/e2e coverage includes save/delete/error and keyboard paths. No new defect confirmed. |
| Settings, persistence, cross-device, offline feedback | Settings sync, save-button, migration, and offline tests reviewed | Mobile settings uses reduced tab navigation | Settings synchronization and save behavior passed in the scoped run. Browser cross-device and service-worker behavior remain manual checks. |

## Confirmed baseline findings

### B-1 — Overview puzzle browser baseline has two deterministic spec/app-contract failures

- **Classification:** Test/specification baseline, not a verified product defect.
- **Severity:** High for test signal; no product severity assigned.
- **Journey:** Explore → Overview → puzzle arrangement → reload/reset.
- **Evidence:** The current baseline note records two deterministic failures in
  `tests/e2e/overview-puzzle-multiselect.spec.ts`: the session-storage
  hydration reload expectation and the Reset-button expectation. The latter
  expects Reset after creating only a group, while the current UI exposes Reset
  only when a tile has a nonzero transform. Earlier unsupported
  `expect.poll(...).toSatisfy` failures were repaired and are not current
  product evidence.
- **User impact:** The browser suite does not reliably validate puzzle
  persistence/reset behavior, so a future regression could be masked. The
  available evidence does not show that a normal user cannot use the feature.
- **Next action:** Create a focused follow-up to align the two browser
  expectations with the intended contract (or change the product contract
  deliberately), then run the spec in isolation three times before reintegrating
  it into the palette suite. Do not fix this in the report-only task.

### B-2 — OverviewMap responsive-interactions baseline is seeded and separately owned

- **Classification:** Existing task baseline; not a new finding.
- **Severity:** Medium for regression signal; no product severity assigned.
- **Journey:** Overview controls at desktop/mobile-sized viewport.
- **Evidence:** The task plan explicitly identifies the inactive-GPS copy and
  redundant puzzle-save visibility expectations, plus related stale type
  references, as pre-existing failures owned by the active OverviewMap task.
  The current isolated `OverviewMap.responsiveInteractions.test.tsx` passed
  after the current branch's typecheck restoration, so the prior failure must
  not be reported as a fresh regression here.
- **User impact:** Historical test expectations could misclassify the GPS
  affordance and puzzle save controls. Current isolated evidence is green and
  does not establish a live user-facing failure.
- **Next action:** Let the already-active OverviewMap remediation task own the
  intended copy/control contract and its browser verification. Do not duplicate
  that work from this audit.

## Manual confirmation queue

These are not confirmed findings. They are the checks that could not be
deterministically exercised by the available authenticated browser harness:

1. **First-run entry and onboarding:** sign in with a fresh account, wait for
   terrain, use Skip and each tour action, reload, and verify the overlay does
   not flash before server settings hydrate. Repeat at a mobile breakpoint and
   confirm the desktop tour is absent while chart navigation remains usable.
2. **Dataset acquisition:** exercise catalog search, NCEI search, upload
   cancellation, retry after a server error, and switching datasets while an
   overview is loading. Confirm each state has an actionable message and no
   stale drawer remains open.
3. **GPS/live:** deny GPS permission, retry acquisition, simulate a position
   outside the loaded bounds, interrupt follow with a pan, and restore GPS.
   Confirm the status, depth card, follow label, and trail state agree.
4. **Planning and marker flows:** create/edit/delete a marker and catch, import
   GPS data, cancel dialogs with Escape/backdrop, and verify offline writes
   surface read-only/buffered feedback rather than silently disappearing.
5. **Settings and offline:** change settings, switch tabs and reload, open a
   second tab, go offline during a save, restore connectivity, and reload an
   offline pack through the service worker. Confirm the newest setting wins and
   stale/error indicators are dismissible.

The Playwright suite documents the environmental limitation explicitly: many
core journey tests skip when the auth bypass, seeded terrain, GPS API, or
controlling service worker is unavailable. A skipped browser test is therefore
not counted as a pass or a product finding in this report.

## Recommended fix / verification order

1. Resolve B-1's two puzzle browser contract failures and rerun the isolated
   spec three times; retain the test-only classification unless a user-facing
   failure is reproduced.
2. Complete the already-active OverviewMap remediation represented by B-2,
   including a real browser check of the GPS affordance and save controls.
3. Run the manual confirmation queue with authenticated desktop and mobile
   sessions, prioritizing onboarding/dataset loading and GPS recovery.
4. Only after those checks produce a reproducible user-visible failure should
   a product fix task be opened; this report does not justify changes to
   application code on its own.

## Required validation

The task-mandated `test-standard` workflow was run on 2026-08-24. It passed
typecheck, lint, all standard guard steps, and the scoped BathyScan checks, but
the tier stopped in the unrelated `@workspace/db` unit suite:

- **14 failures in 3 test files** (`audit-marker-dataset-bbox.test.ts`,
  `markers-dataset-unassign.test.ts`, and `markers.test.ts`)
- All failures share the existing test-database schema error:
  `column "expires_at" of relation "markers" does not exist`
- This is an API/database test-fixture issue outside the UX sweep and was not
  changed or reclassified as a UX finding.

## Scope exclusions

This sweep did not audit every BathyScan panel, administrative tools,
third-party service behavior, unrelated API-server findings, or dependency and
validation infrastructure. Those remain covered by the existing bug audit and
active project tasks.