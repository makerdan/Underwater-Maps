# BathyScan UX E2E Audit Report

**Scope:** `artifacts/bathyscan` (React/Vite/R3F + mobile 2D chart shell) and
`artifacts/api-server` (Express 5 API).
**Date:** 2026-08-19.
**Mode:** **Report-only** — no application source, tests, configuration, or
generated artifacts were changed. Phase 13 fix loop was intentionally not run.
**Method:** Current-tree code inspection, prior-report seed verification, and
registered validation coverage. Live-device-only observations are explicitly
marked `[MANUAL QA NEEDED]`.

## Stack and audit gates

- TypeScript 5.9, React 19, Vite, React Three Fiber, Zustand, TanStack Query,
  Express 5, Drizzle/PostgreSQL, Clerk, Poe AI.
- `backend: true` — API routes, uploads, server settings, catalog, markers,
  weather/tide, and offline-pack requests are present.
- `auth: true` — Clerk-compatible sign-in/sign-up routes, protected API calls,
  session-expiry detection, permission-gated admin UI, and sign-out cleanup.
- `multi-tool: true` — Explore, Plan, Analyze, Live, Overview Map, GPS, marker,
  drift, overlay, offline, and settings tools.
- `interactions: true` — keyboard shortcuts, drag/drop uploads, map gestures,
  clipboard/export paths, and touch/mobile interactions.
- Third-party Clerk widget internals and `artifacts/mockup-sandbox` internals
  are out of scope. The Python BAG parser is also out of scope; only its
  application integration, progress, error, and attribution behavior was
  considered.

## Summary of current findings

| Severity | New/open findings | Deferred seeds | Closed/re-verified seeds |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 4 | 0 | 0 |
| Medium | 4 | 1 | 0 |
| Low | 4 | 0 | 0 |
| **Total** | **12** | **1** | **all other prior seeds** |

The deferred seed is included in the finding index and full findings below,
but is not duplicated as a new finding.

## Finding index (sorted by severity)

| ID | Journey | Phase | Severity | User-visible failure | Status |
|---|---|---|---|---|---|
| F-001 | J4 Custom upload | 4/12 | High | Fixed-width upload/import dialogs can exceed a 375px viewport | Open |
| F-002 | J9 Settings | 8/12 | High | Settings remains a two-column desktop layout at phone widths | Open |
| F-003 | J15 Auth/session | 9 | High | A false session-expiry signal remains until a full reload | Open |
| F-004 | J2/J5 Search | 5/12 | High | Find Data is still a clipped, single-close-control drawer on narrow screens | Open |
| F-005 | J6/J14 Lists | 4/12 | Medium | Marker lists render without a bounded/virtualized window | Open |
| F-006 | J14 Catch journal | 4/12 | Medium | Catch journal renders every entry in one DOM pass | Open |
| [SEED F-008] | J4 Custom upload | 11 | Medium | Upload jobs and queue state are lost on API restart | Deferred — architectural |
| F-007 | J5/J9 Persistence | 2/10 | Medium | Settings sync can remain stale during prolonged failure/backoff | Open |
| F-008 | J4/J7/J11 dialogs | 5/12 | Medium | Operation-locked dialogs have no alternate recovery if the operation stalls | Open |
| F-009 | J4/J7/J11 dialogs | 5 | Low | Several dialogs do not restore focus to their triggering control | Open |
| F-010 | All async errors | 10 | Low | Repeated identical errors can stack duplicate toasts | Open |
| F-011 | All responsive views | 12 | Low | Some user-provided names remain vulnerable to long-string layout pressure | Open |
| F-012 | All overlays | 12 | Low | Several overlay families share z-index values and depend on DOM order | Open |

## App map and journey coverage

Each journey was checked from a clean-state model (empty local persistence,
fresh route, no active terrain unless the journey requires it), then against
reload, navigation round-trip, mode switching, failure feedback, and
second-tab behavior where applicable.

| # | Journey | Phase result | Current result |
|---|---|---|---|
| J1 | First-run / onboarding | PASS | Seen-state hydration, skip/done, replay, and mobile chart entry are wired. |
| J2 | Catalog terrain | PASS with F-010/F-012 | Dataset query, selection, loading, terrain handoff, and empty/error states exist. |
| J3 | My Saves | PASS | Load path and retry feedback are wired; no new silent retry failure found. |
| J4 | Custom upload | FINDING | Rejection feedback, finalize `jobId` validation, progress, and cleanup are present; responsive dialog sizing and restart durability remain. |
| J5 | Federated search → save | FINDING | Search/save errors are surfaced and names are truncated in current results; narrow drawer remains problematic. |
| J6 | Markers create/edit/delete | FINDING | CRUD, undo/delete invalidation, and dialog Escape paths are present; high-volume rendering remains unbounded. |
| J7 | GPS import/export | FINDING | Import validation, cancellation, Escape, and export paths exist; fixed-width dialogs and focus return remain. |
| J8 | Drift planner | PASS | Saved-plan load clears stale coordinates; rename failure surfaces a retryable toast. |
| J9 | Settings | FINDING | Controls, URL tab restore, server validation, save/error state, and reset paths are wired; phone layout and prolonged sync failure remain. |
| J10 | Palette / heatmap | PASS | Palette hydration, band guards, reset, and cross-tab rehydration are present. |
| J11 | Offline packs | FINDING | Terrain timeout and weather/marker omissions are surfaced; stalled operation recovery and modal sizing remain. |
| J12 | Live / GPS follow | PASS | Mobile GPS-camera mirror, follow guards, live cleanup, and wake-lock intent are present. |
| J13 | Environment overlays | PASS | Terrain gating, water-type behavior, attribution, and current/tide settings paths are present. |
| J14 | Catch journal | FINDING | Create/edit/delete and empty/error states exist; entry rendering is unbounded. |
| J15 | Auth/session | FINDING | Protected routing, query isolation, sign-out reset manifest, and re-login isolation are present; expiry latch recovery remains. |
| J16 | Help | PASS | Help route/button, mobile full-screen presentation, close behavior, and focus restoration inside HelpWindow are present. |

## Phase coverage

| Phase | Status | Evidence and scope |
|---|---|---|
| Ph0 Discovery & app map | PASS | Router, stores, settings, dialogs, uploads, API routes, responsive branches, and prior reports inspected; all 16 journeys retained. |
| Ph1 Happy paths | PASS with findings | All 16 journeys have a complete code-level happy path; F-001–F-004 affect reachable variants. |
| Ph2 State & persistence | PASS with F-007 | Settings, palette, panel collapse, drift plans, zone slots, help, and device-local state are read and applied; cross-tab listener is mounted. |
| Ph3 Silent failures | PASS with seed verification | User-triggered writes generally surface errors; folder rename, My Saves retry, offline weather, and settings response validation seeds are fixed. |
| Ph4 Error & edge cases | FINDINGS | Upload and validation paths are guarded; unbounded marker/journal lists remain. |
| Ph5 Navigation & dead ends | FINDINGS | Catch-all `NotFound` route and modal Escape paths are present; operation-stall and focus-return gaps remain. |
| Ph6 Keyboard & interactions | PASS | FlyControls and global Escape handlers guard focused form controls; shortcut routes and drag/drop rejection paths are wired. |
| Ph7 Tool/mode switching | PASS | Explore/Plan/Analyze/Live switching preserves store state and mobile shell uses the same persisted sidebar mode. |
| Ph8 Settings & preferences | FINDINGS | Controls and resets are wired; phone geometry and long sync backoff are open findings. |
| Ph9 Auth & session | FINDING | Clerk boundary, protected data, admin probe, sign-out manifest, and query clearing are present; F-003 remains. |
| Ph10 Feedback & polish | FINDING | Loading/error copy is broadly present; F-010 remains for toast deduplication. |
| Ph11 Data lifecycle | FINDINGS | Create/edit/delete/import/export paths were traced; upload durability remains deferred and offline/dialog recovery remains open. |
| Ph12 Cross-context | FINDINGS | 375/768/1280 code paths and mobile shell inspected; manual-device checks are listed below. |
| Ph13 Report-only triage | COMPLETE | Findings de-duplicated, severity-sorted, seeds carried, and no fix loop entered. |

## Prior seed disposition

### Deferred and still open

#### [SEED F-008] — Upload job state is in memory only

- **Journey:** J4 Custom upload
- **Phase:** 11 — Data lifecycle
- **Severity:** Medium
- **Failure:** If the API restarts during chunk processing or queued object
  work, module-level job/queue state disappears. The client can continue
  polling a missing job or leave the user without a resumable upload.
- **Fix:** Persist upload job state, queue position, and recoverable chunk
  status in the database; until then, make a missing poll job a visible,
  retryable upload-interrupted state. This remains deferred because it is an
  architectural durability change, not a report-only UX fix.

### Closed or re-verified in the current tree

- Folder rename failure now shows a destructive toast and preserves the edit
  value for retry.
- Server settings responses pass `parseSettingsResponse` before hydration.
- Mirrored UI/settings fields use the shared key list and invariant coverage.
- Upload finalize validates `jobId`; top-level/sidebar error boundaries exist.
- Catalog startup failures are logged and catalog endpoints are rate-limited.
- Offline weather omission and service-worker cache timeout are surfaced.
- Wake-lock catches are documented as intentional non-fatal failures.
- Currents writes use value-based timing and skip redundant updates.
- Catch-all `NotFound` route is mounted.
- Sign-out cleanup resets drift plans, GPS mappings, camera/live/puzzle state,
  settings, palette, and user query/offline identity data; the manifest guard
  covers the cleanup.
- Dialog Escape handling, FileUpload rejection feedback, stale drift-start
  clearing, cross-tab storage rehydration, dataset-panel narrow sizing, and
  search-result truncation are present.
- My Saves retry failure now has visible error handling.

## Full findings

### F-001 — Fixed-width upload/import dialogs exceed narrow viewports

- **Journey:** J4 Custom upload; J7 GPS import/export; J11 Offline packs
- **Phase:** 4 — Error & edge cases; 12 — Cross-context
- **Severity:** High
- **Failure:** At 375px, GpsImportDialog (520px), BulkOfflinePanel (500px),
  SimulatedDataConfirmDialog (480px), ReassignMarkersDialog (480px),
  GpsExportDialog (460px), and OfflinePackModal (460px) request widths wider
  than the viewport. Content and close/cancel controls can be clipped, making
  a phone user unable to finish or dismiss the flow.
- **Fix:** Apply a shared responsive modal shell with `max-width:
  calc(100vw - 32px)`, bounded `max-height`, internal scrolling, and an
  always-visible operation cancel/progress control. Verify at 375px and 390px.

### F-002 — Settings remains structurally desktop-sized on phones

- **Journey:** J9 Settings
- **Phase:** 8 — Settings; 12 — Responsive
- **Severity:** High
- **Failure:** `Settings.tsx` still renders the fixed 180px sidebar and the
  desktop two-column `S.layout`/`S.content` geometry. At 375px the content
  column is severely constrained and the topbar action cluster can collide.
  The custom `Toggle` is a 36×20 non-button clickable, below the mobile target
  size.
- **Fix:** At the mobile breakpoint stack or horizontally scroll the section
  navigation, make content full width, simplify/wrap the topbar, and expose
  Toggle as a keyboard-accessible `button`/`role="switch"` with a 44px target.

### F-003 — Session-expiry signal is a page-lifetime latch

- **Journey:** J15 Auth/session; J2/J5 API-backed loading
- **Phase:** 9 — Auth & session
- **Severity:** High
- **Failure:** `signalSessionExpired()` sets `_isSessionExpired` to true and
  never clears it. A short token-refresh/network blip can trip the threshold;
  even after Clerk recovers and authenticated requests succeed, the banner
  remains until the user manually reloads. On a mobile/background-resume path
  this is a reachable misleading block.
- **Fix:** Clear the signal after a confirmed authenticated request or fresh
  Clerk session, or provide a re-authenticate action that resets the latch
  after successful recovery. Preserve the offline-read-only distinction.

### F-004 — Find Data remains a clipped narrow-screen drawer

- **Journey:** J2 Catalog terrain; J5 Federated search → save
- **Phase:** 5 — Navigation; 12 — Responsive
- **Severity:** High
- **Failure:** The desktop `FindDataPanel` still uses a fixed 380px drawer.
  On a 375px viewport it covers the entire screen with its left edge clipped;
  dismissal depends on one small close control, with no backdrop or Escape
  fallback. The mobile chart shell replaces the main 3D scene, but does not
  provide an equivalent Find Data drawer, so this path is still reachable from
  shared app controls.
- **Fix:** Route Find Data to a mobile-width sheet/full-screen surface with a
  minimum 44px close target and a reliable back/close path; confirm the mobile
  dataset picker and federated-search entry points do not leave two competing
  discovery surfaces.

### F-005 — Marker list has no bounded rendering strategy

- **Journey:** J6 Markers
- **Phase:** 4 — Empty/high-volume states; 12 — Cross-context
- **Severity:** Medium
- **Failure:** `MarkersPanel` renders the complete API marker array in one
  render. A large imported GPS set can cause scroll jank, long commit times,
  and an unresponsive sidebar.
- **Fix:** Virtualize marker rows or paginate/load more, keeping empty,
  loading, selection, and delete/undo states intact.

### F-006 — Catch journal renders every entry at once

- **Journey:** J14 Catch journal
- **Phase:** 4 — Empty/high-volume states; 12 — Cross-context
- **Severity:** Medium
- **Failure:** `CatchJournalPanel` maps all fetched entries into the DOM.
  Long-running field use can accumulate hundreds of entries and degrade
  scrolling and memory without changing the user's visible workflow.
- **Fix:** Add server/client pagination or virtualization with a stable
  empty state and preserved edit/delete behavior.

### F-007 — Prolonged settings sync failure can leave the user stale

- **Journey:** J5 Save; J9 Settings; J15 Auth/session
- **Phase:** 2 — Persistence; 10 — Feedback
- **Severity:** Medium
- **Failure:** The sync pipeline enters exponential backoff after repeated PUT
  failures. The toast and Settings header expose failure/retry, but a user who
  leaves Settings or misses the toast can continue believing the latest
  setting is cloud-synced while the server remains stale until a retry succeeds.
- **Fix:** Keep a persistent, route-independent unsynced indicator with a
  retry action, and make the next settings-dependent load distinguish local
  pending state from server-acknowledged state.

### F-008 — Operation-locked dialogs lack a recovery path if work stalls

- **Journey:** J4 Upload; J7 GPS import; J11 Offline packs
- **Phase:** 5 — Trapped states; 11 — Data lifecycle
- **Severity:** Medium
- **Failure:** Several dialogs intentionally disable backdrop, Escape, and
  close while importing/downloading. If the worker, service worker, or network
  operation stalls without resolving, the user can be trapped behind a modal
  until a watchdog or browser reload occurs.
- **Fix:** Keep destructive cancellation guarded, but add an explicit
  cancel/abort action and a visible watchdog timeout that returns the dialog to
  a recoverable error state.

### F-009 — Modal close does not consistently restore trigger focus

- **Journey:** J4, J6, J7, J8, J11
- **Phase:** 5 — Navigation and focus management
- **Severity:** Low
- **Failure:** GpsImport, GPS export, georeference, reassign, marker, and
  offline flows do not consistently retain the opener and focus it after
  unmount. Keyboard users can land at an unrelated document position after a
  modal closes.
- **Fix:** Capture the opener ref before opening and restore focus on every
  close path, including error and cancellation.

### F-010 — Duplicate toasts are not globally deduplicated

- **Journey:** All API-backed journeys
- **Phase:** 10 — Feedback and polish
- **Severity:** Low
- **Failure:** Independent retries or repeated polling failures can create
  multiple identical toast cards. This can obscure the actionable message and
  make a transient failure look worse than it is.
- **Fix:** Add a stable error key/type to the toast utility and coalesce an
  existing matching toast within a short interval.

### F-011 — Long names are not uniformly constrained across list surfaces

- **Journey:** J2/J3/J5 catalog and saves; J8 drift; J14 journal
- **Phase:** 12 — Long strings
- **Severity:** Low
- **Failure:** Some result/list surfaces now truncate names, but the audit did
  not find a single shared constraint applied to every user/provider name.
  Very long dataset, folder, plan, or journal text can still increase row
  height and push actions out of view at narrow widths.
- **Fix:** Use a shared title style/component with flex `min-width: 0`,
  ellipsis or controlled wrapping, and a full-name accessible label.

### F-012 — Overlay z-index ties remain DOM-order dependent

- **Journey:** All overlay/modal journeys
- **Phase:** 12 — Cross-context layering
- **Severity:** Low
- **Failure:** Several modal, banner, toast, context-menu, and loader layers
  share z-index values. The current mount order generally works, but a future
  conditional render can place a context menu beneath a modal or a toast
  beneath a drawer without any local component indicating the problem.
- **Fix:** Define a centralized overlay scale with distinct ranges for
  banners, drawers, dialogs, context menus, and toasts; add a stacking-order
  smoke test for simultaneous layers.

## Manual QA needed

The following require a real browser/device and are not overstated as confirmed
failures by this report:

| Area | Manual check |
|---|---|
| F-001/F-002/F-004 | Render at 375px, 390px, 768px, 1280px and confirm clipping, hit targets, and scroll behavior. |
| F-003 | Simulate a token-refresh blip followed by a successful authenticated request; confirm the banner recovers without reload. |
| F-008 | Stall a worker/service-worker/network request and confirm cancel/watchdog recovery. |
| F-009 | Keyboard-only open/close for every dialog and verify focus return. |
| F-012 | Open context menu, toast, drawer, and modal together at each route and verify intended stacking. |
| Mobile chart | Verify touch pan/zoom, bottom-sheet drag/collapse, safe-area insets, and browser zoom on iOS/Android. |

## Validation and known baseline

The task's required registered command is `test-heavy`; it is the only
validation tier selected for this report-only audit. Known baseline failures
remain excluded from UX findings: the documented full-E2E find-data/live-mode/
GPS-trail/follow-handoff/TOPO families and the documented puzzle-e2e
`toSatisfy` and plan-archive gates. Any other failure is a potential regression
and must follow the three-isolated-retries rule.

### Validation result

`test-heavy` completed in 258.6 seconds with exit 1. Typecheck, lint, and the
other full-tier guards passed; the BathyScan unit step reported 5,703 passed
tests and one failed test. The failure was isolated three times and reproduced
3/3:

- `src/__tests__/apiClientMockSentinel.test.ts`
- `useStartChunkedUpload` is classified by the generated client as a mutation,
  but `src/__tests__/apiClientMock.ts` returns the noop fallback.

This is a deterministic generated-hook/mock contract failure associated with
the concurrent upload-safety work, not a UX finding from this audit. No product
or test code was changed.

No fix task was created from inside this report-only audit. The next step is
triage: prioritize F-001–F-004 and the deferred upload durability seed before
polish items.