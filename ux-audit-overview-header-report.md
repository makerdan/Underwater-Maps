# BathyScan — Overview Map Header Bar UX Audit

**Scope:** `artifacts/bathyscan` OverviewMap header and the interactions it
opens, closes, or controls.

**Date:** 2026-08-21.

**Mode:** **Report-only** — no application source, test, configuration, or
generated artifact was changed.

**Method:** Current-tree inspection of `OverviewMap.tsx`, responsive and
daylight CSS, related state/action handlers, prior UX reports, existing
OverviewMap tests, and the project task list. Browser-only conclusions are
explicitly marked `[MANUAL QA NEEDED]`.

## Stack and audit gates

- React 19 + TypeScript + Vite, Zustand, TanStack Query, and a canvas/SVG
  OverviewMap surface.
- `backend: true`: the header can save, restore, and delete server-backed
  special-collection layout revisions.
- `auth: true`: server-saved layouts are account-scoped.
- `multi-tool: true`: Overview is opened from the shared HUD/sidebar and
  switches between normal map, selection/download/waypoint, and puzzle modes.
- `interactions: true`: keyboard Escape/O behavior, canvas pan/zoom, drag,
  selection, and puzzle tile manipulation are present.
- Third-party tooltip internals are out of scope. This audit checks whether
  header controls remain understandable and operable when tooltips are
  disabled or unavailable.

## Prior-audit seed disposition

The prior full UX report and mobile UX report were used as seeds. Their
general overlay/z-index and mobile touch findings were not duplicated unless
the header directly amplified them:

- The mobile OverviewMap mouse-only interaction finding remains relevant to
  the map journey, but is not a header-bar finding and is not duplicated here.
- The prior mobile report's general sub-44px clickable inventory is narrowed
  here to the header's desktop/mobile controls.
- The prior report's daylight theme and long-string concerns are re-evaluated
  specifically for the header below.

## Header journey map

| ID | Journey | Clean-state goal and variants |
|---|---|---|
| J1 | Open, understand, and close Overview | Open from the HUD/sidebar, identify map controls, use `O`/Escape or Close, then return to the prior view. Desktop, 375px, 768px, daylight, keyboard. |
| J2 | Navigate and orient the map | Read the usage hint, pan/zoom, use Zoom In/Out/FIT, inspect camera/GPS state, and avoid accidental canvas interaction. Empty/no-data and loaded-data variants. |
| J3 | Use GPS actions | Observe GPS active/error/out-of-bounds states, use DIVE HERE when eligible, and understand when the action is unavailable. |
| J4 | Enter and exit puzzle mode | Toggle Puzzle, verify exclusive modes are cleared, manipulate/select tiles, and return to normal map behavior. |
| J5 | Inspect and adjust puzzle state | Toggle SNAP/GAPS, apply a puzzle layout to 3D, group/ungroup/lock, and reset transformed tiles. |
| J6 | Save and restore puzzle layouts | Save to session, name a layout, open LAYOUTS, restore/delete local or server revisions, and recover from save/delete failures. Reload/navigation and long-name variants. |
| J7 | Recover from map loading/error states | Wait through no-data/loading/error, use Retry or Find Data, and close/reopen without losing a reachable recovery action. |

## Gate and evidence summary

| Area | Result |
|---|---|
| Desktop happy paths | Mostly wired in code; dense ordering and abbreviated labels reduce efficiency. |
| 375px / 768px responsive behavior | **Finding:** outer header wraps, but the control cluster does not wrap or scroll. Rendered geometry needs browser confirmation. |
| Daylight theme | **Finding:** broad `!important` rules flatten header control colors and state contrast. |
| Keyboard/focus | Escape/O close paths exist; header buttons are native controls, but there is no header-specific focus/keyboard regression coverage and no explicit accessible names for several icon-led actions. |
| Disabled/loading/error feedback | FIT is visibly disabled; server save errors toast; session save quota errors and server active-revision persistence errors are silent. |
| Long labels | Special-collection badge and layout menu rows ellipsize, but accessible/full-name behavior and compound row usability need confirmation. |
| Dense puzzle mode | **Finding:** conditional controls can expand from a compact row into a very wide sequence of actions, with no grouping, overflow strategy, or compact mode. |
| Existing tests | Error-state tests cover Retry and error hint; component tests cover rendering/LOD and separate puzzle tests cover selected interactions. No focused header journey suite covers responsive overflow, focus order, disabled semantics, or persistence failure feedback. |

## Severity summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 4 |
| **Total** | **10** |

## Findings

### High

### F-001 — Dense puzzle header can run beyond the phone viewport

- **Journey:** J4/J5/J6 — Enter, adjust, and save puzzle layouts
- **Phase:** 12 — Cross-context responsive layout; also observed in Phases 1 and 10
- **Severity:** High
- **Failure:** At 375px, the mobile CSS lets `.overview-map-header` wrap, but its
  right-side child at `OverviewMap.tsx:4568` is a single flex row with no
  `flex-wrap`, horizontal scrolling, or minimum-width strategy. Puzzle mode can
  add SNAP, GAPS, RESET, SAVE, SAVE LAYOUT, LAYOUTS, selection actions, group
  actions, lock, rotation, flip, tools, and related controls. The title and
  hint also consume the same header width. Controls can therefore overflow or
  be pushed outside the visible header; the user may be unable to close the
  map or reach reset/save without changing viewport or zoom.
- **Fix:** Split the header into stable title/status and action regions, then
  give the action region a responsive layout: wrap into intentional groups or
  use a horizontally scrollable/overflow menu with a visible close action
  pinned to the viewport. Preserve keyboard order and verify at 375px, 390px,
  768px, 1280px, and browser zoom 150%. A compact puzzle toolbar or secondary
  menu should prevent every conditional action from competing with FIT/GPS and
  Close.
- **Evidence:** `OverviewMap.tsx:4521-4568,4639-5050,5197-5790`;
  `index.css:382-388`.
- **[MANUAL QA NEEDED]:** Confirm actual clipping, horizontal scroll reachability,
  and touch hit testing in Chromium at 375px and 768px with puzzle controls
  fully expanded.

### F-002 — Header does not preserve a reliably reachable close action under overflow

- **Journey:** J1 — Open, understand, and close Overview
- **Phase:** 5 — Navigation and dead-ends; Phase 12 — Responsive layout
- **Severity:** High
- **Failure:** Close is the last control in the same right-side sequence as GPS,
  FIT, Puzzle, and all conditional puzzle actions
  (`OverviewMap.tsx:5768-5788`). There is no fixed/pinned close affordance in
  the header. When the dense sequence overflows as described in F-001, the
  user-visible escape route depends on a control that may be off-screen.
  Escape and the `O` shortcut are useful workarounds, but they are not
  discoverable or dependable on touch-only devices.
- **Fix:** Keep a clearly named Close button in a non-overflowing header slot
  (or provide a persistent top-corner close control) and retain Escape/O as
  secondary paths. Add an accessible name and test that Close remains visible
  when every puzzle-only control is rendered.
- **Evidence:** `OverviewMap.tsx:4521-4568,5768-5788`; global Escape handling
  is documented near `OverviewMap.tsx:1322` and in `App.tsx`.
- **[MANUAL QA NEEDED]:** Verify the close target remains visible and tappable
  at 375px with the longest supported puzzle toolbar state.

### Medium

### F-003 — Session save reports success even when browser storage rejects it

- **Journey:** J6 — Save and restore puzzle layouts
- **Phase:** 3 — Silent failure hunt; Phase 10 — UI feedback
- **Severity:** Medium
- **Failure:** The header's `✦ SAVE` handler catches `sessionStorage.setItem`
  errors and intentionally does nothing, then immediately sets `puzzleSaved`
  and displays `✓ SAVED` for 1.5 seconds
  (`OverviewMap.tsx:4813-4824`). If storage is blocked, full, or unavailable,
  the user is told the layout was saved even though the requested session
  persistence did not occur.
- **Fix:** Track the storage write result. Show `SAVED` only after a successful
  write, and show an actionable non-destructive error state/toast when both
  session storage and any intended fallback fail. Keep the current in-memory
  arrangement usable and distinguish it from persisted state.
- **Evidence:** `OverviewMap.tsx:4813-4824`; the automatic transform persistence
  path also catches storage errors silently at `OverviewMap.tsx:561-579`.
- **[MANUAL QA NEEDED]:** Simulate blocked/full storage in a real browser and
  confirm the visible result never claims persistence after failure.

### F-004 — Server active-revision persistence can silently diverge from the UI

- **Journey:** J6 — Restore a server-saved puzzle revision
- **Phase:** 3 — Silent failure hunt; Phase 2 — State and persistence
- **Severity:** Medium
- **Failure:** `restoreServerRevision` updates the local active revision and closes
  the dropdown immediately, while `patchUserCollectionsIdMeta(...).catch(() => {})`
  ignores a failed server write (`OverviewMap.tsx:886-890`). The current tab
  appears to have restored and selected the revision, but a reload or another
  device can show the previous active revision with no explanation or retry.
- **Fix:** Await the metadata write, expose pending/success/error state in the
  LAYOUTS control, and either roll back the active-revision indicator or mark it
  clearly as locally applied until the server acknowledges it. Provide a retry
  action without losing the selected layout.
- **Evidence:** `OverviewMap.tsx:860-890`.
- **[MANUAL QA NEEDED]:** Force the metadata request to fail and verify the
  dropdown/header communicates the unsynced state after navigation and reload.

### F-005 — Destructive revision deletion has no confirmation or in-flight guard

- **Journey:** J6 — Open LAYOUTS and delete a saved revision
- **Phase:** 4 — Error and edge cases; Phase 11 — Data lifecycle
- **Severity:** Medium
- **Failure:** Each server revision exposes a small `✕` button that calls
  `void deleteServerRevision(rev)` directly
  (`OverviewMap.tsx:4960-4975`). There is no confirmation, pending/disabled
  state, or optimistic rollback. A rapid repeat can issue multiple deletes, and
  a mistaken click can remove a named layout immediately. A failed request
  does toast, but the action has no inline status.
- **Fix:** Add a confirmation step that names the revision, disable the row action
  while deletion is pending, and preserve/reinsert the row if the request
  fails. Keep the error toast as supplemental feedback and ensure the delete
  control has a clear accessible name.
- **Evidence:** `OverviewMap.tsx:894-909,4960-4975`.
- **[MANUAL QA NEEDED]:** Verify rapid clicks and keyboard activation cannot
  submit duplicate deletes and that the confirmation remains usable in the
  narrow dropdown.

### F-006 — Header action meaning depends too heavily on hover/focus tooltips

- **Journey:** J2/J3/J4/J5 — Understand FIT, DIVE HERE, Puzzle, SNAP, GAPS,
  APPLY TO 3D, and layout actions
- **Phase:** 1 — Happy-path efficiency; Phase 6 — Keyboard and interaction;
  Phase 10 — Feedback
- **Severity:** Medium
- **Failure:** Several controls use abbreviated labels (`FIT`, `SNAP`, `GAPS`,
  `LAYOUTS`, `✦ SAVE`) and put the explanatory sentence only in
  `ViewscreenTooltip`. When `showUiTooltips` is disabled, the wrapper returns
  the child unchanged; on touch there is no hover tooltip. The visible labels
  do not consistently state scope or consequence, especially for `FIT`,
  `GAPS`, and `SAVE`, so a user must infer the action or remember the
  interaction model.
- **Fix:** Give every header control a stable accessible name and a concise
  visible label or adjacent help text for ambiguous actions. Keep tooltips as
  supplemental detail, not the only explanation; use `aria-label`, `aria-keyshortcuts`
  where applicable, and announce state changes such as saved/unsynced/error.
- **Evidence:** `OverviewMap.tsx:4614-4874,4881-4903,5768-5788`;
  `ViewscreenTooltip.tsx:42-72`.
- **[MANUAL QA NEEDED]:** Check comprehension with tooltips disabled and on a
  touch device where hover/focus behavior is unavailable.

### Low

### F-007 — Daylight theme flattens active and inactive header states

- **Journey:** J2/J4/J5 — Read map and puzzle state in daylight theme
- **Phase:** 10 — UI feedback and polish; Phase 12 — Cross-context themes
- **Severity:** Low
- **Failure:** Daylight CSS applies `color: #0a0a0a !important` to every
  descendant and applies the same cobalt border treatment across
  `.overview-map-header *` (`index.css:195-242`). This overrides the inline
  cyan, purple, green, orange, teal, red, and indigo state colors used to
  distinguish Puzzle, SNAP, GAPS, Reset, Save, and layout actions
  (`OverviewMap.tsx:4657-4868`). The controls remain present, but active
  versus inactive and action-risk distinctions may be reduced to subtle
  background differences.
- **Fix:** Add daylight-specific semantic tokens for active, inactive,
  destructive, success, and warning states, with contrast-tested text and
  borders. Do not blanket-override all header descendants; preserve
  `aria-pressed` state through a visible non-color cue as well.
- **Evidence:** `index.css:195-242`; `OverviewMap.tsx:4642-4868`.
- **[MANUAL QA NEEDED]:** Verify contrast and state recognition under daylight
  theme at normal and 150% browser zoom.

### F-008 — Header controls lack explicit focus styling and focused-action tests

- **Journey:** J1/J4/J6 — Keyboard open/close, puzzle mode, and layout saving
- **Phase:** 6 — Keyboard and interaction; Phase 10 — UI feedback
- **Severity:** Low
- **Failure:** Header buttons are native keyboard controls and Puzzle/SNAP/GAPS/
  Lock expose `aria-pressed`, but the header supplies no local `:focus-visible`
  treatment or test asserting focus visibility/order. Inline borders and
  daylight overrides can make the browser default focus indicator difficult to
  distinguish against the canvas. The existing tests cover store mirroring,
  error Retry, LOD, and selected puzzle actions, not a complete header tab
  journey.
- **Fix:** Add a high-contrast `:focus-visible` style scoped to
  `.overview-map-header`, preserve it in daylight mode, and add a keyboard
  smoke test for tab order, `aria-pressed`, disabled FIT, Close, and Escape/O
  behavior.
- **Evidence:** `OverviewMap.tsx:4614-5788`; `index.css:195-242,382-388`;
  existing coverage in `OverviewMap.errorState.test.tsx`,
  `overviewMap.componentIntegration.test.ts`, and
  `HudOverviewToggle.test.tsx`.
- **[MANUAL QA NEEDED]:** Confirm the visible ring against the canvas and
  daylight header using keyboard-only navigation.

### F-009 — Long collection names are visually truncated without a clear full-name path

- **Journey:** J4/J6 — Work in puzzle mode and restore a named layout
- **Phase:** 4 — Edge cases; Phase 12 — Long strings
- **Severity:** Low
- **Failure:** The active special-collection badge is capped at 140px and
  ellipsized (`OverviewMap.tsx:4675-4693`), and revision/layout restore buttons
  ellipsize their names in a menu (`OverviewMap.tsx:4945-4952,4997-5005`).
  The badge has a title, but the menu's full name is not guaranteed to be
  discoverable for keyboard or touch users; long names can make similarly
  named revisions hard to distinguish.
- **Fix:** Keep the compact truncation but expose the full name through an
  accessible description and a focusable detail/title treatment. Consider
  wrapping the menu label to two lines while keeping delete actions aligned.
- **Evidence:** `OverviewMap.tsx:4675-4693,4907-4959,4978-5028`.
- **[MANUAL QA NEEDED]:** Verify long names, RTL text, emoji, and 150% zoom in
  the open dropdown at 375px and desktop widths.

### F-010 — Header-specific regression coverage does not protect the dense control contract

- **Journey:** J1–J7 — All scoped Overview header journeys
- **Phase:** 13 — Report-only triage; test-gap observation across Phases 1–12
- **Severity:** Low
- **Failure:** Existing tests prove important isolated behavior, but there is no
  focused contract covering the header's conditional control matrix, responsive
  overflow, focus order, `aria-pressed`/disabled semantics, save failure
  feedback, revision delete guard, or daylight state contrast. A future header
  change can silently make the close or puzzle layout flow unreachable while
  the current tests remain green.
- **Fix:** Add a focused Overview header test matrix using the existing
  provider/store mock patterns. Cover no-data, GPS error/out-of-bounds,
  puzzle-selected, special-collection, long-name, failed-save, failed-delete,
  keyboard, and narrow viewport states. Add a browser-level responsive
  assertion for reachability rather than relying only on DOM presence.
- **Evidence:** Current focused coverage is in
  `OverviewMap.errorState.test.tsx`,
  `overviewMap.componentIntegration.test.ts`,
  `HudOverviewToggle.test.tsx`, and puzzle-specific suites; the header itself
  spans `OverviewMap.tsx:4520-5790`.

## Manual QA register

| Finding | Live-browser/device check |
|---|---|
| F-001/F-002 | 375px and 768px with all puzzle controls visible; check clipping, scroll reachability, and Close hit testing. |
| F-003 | Block or fill session storage and confirm SAVE never reports false success. |
| F-004 | Fail the active-revision metadata request; navigate/reload and confirm the unsynced state is understandable and retryable. |
| F-005 | Rapid keyboard/touch deletion attempts in the open LAYOUTS menu; verify confirmation and disabled state. |
| F-006 | Tooltips disabled, touch device, and keyboard-only use; confirm every action remains understandable. |
| F-007 | Daylight theme at 100% and 150% zoom; compare active/inactive/destructive states for contrast. |
| F-008 | Keyboard tab ring and Escape/O close behavior at desktop, 375px, and daylight. |
| F-009 | 80/120-character names, emoji, RTL text, and 150% zoom in badge and dropdown. |
| F-010 | Run the proposed browser smoke matrix against the actual preview; DOM tests cannot prove visual overflow. |

## Proposed follow-up tasks

The findings are grouped into narrowly scoped tasks. These are proposals only;
this report does not create or implement them.

### Follow-up A — Keep Overview controls reachable on phones and in dense puzzle mode

- **Findings:** F-001, F-002
- **Priority:** High
- **Scope:** Refactor the header into responsive title/action groups, preserve a
  pinned Close affordance, and validate 375/390/768/1280 widths plus 150% zoom.
- **Relevant files:** `artifacts/bathyscan/src/components/OverviewMap.tsx`,
  `artifacts/bathyscan/src/index.css`.

### Follow-up B — Make puzzle layout saving and deletion tell the truth

- **Findings:** F-003, F-004, F-005
- **Priority:** High
- **Scope:** Surface storage/server persistence failures, add pending/rollback
  behavior, and protect destructive revision deletion with confirmation and
  duplicate-submit guards.
- **Relevant files:** `artifacts/bathyscan/src/components/OverviewMap.tsx`,
  relevant special-collection store/API mocks and tests.

### Follow-up C — Make every Overview header action keyboard- and theme-safe

- **Findings:** F-006, F-007, F-008, F-009, F-010
- **Priority:** Medium
- **Scope:** Add stable accessible names and visible focus/state treatment,
  preserve daylight semantics, improve long-name disclosure, and add a
  header-focused responsive/keyboard regression matrix.
- **Relevant files:** `artifacts/bathyscan/src/components/OverviewMap.tsx`,
  `artifacts/bathyscan/src/components/ViewscreenTooltip.tsx`,
  `artifacts/bathyscan/src/index.css`, and
  `artifacts/bathyscan/src/__tests__/`.

## Validation and known baseline

The assigned validation ceiling is `test-fast`. This report-only audit made no
application or test changes, so the fast tier is sufficient for the plan/report
workflow and static project health. The task plan records the known baseline:
puzzle-related E2E expectations and plan-archive gates may fail independently of
this report and must not be treated as audit regressions. If an unexpected test
fails, isolate it three times before classifying it.

## Report-only completion

Phase 13 is intentionally stopped at triage. No fixes, redesign, or regression
tests were applied. The next step is to select one of the proposed follow-up
tasks, starting with responsive reachability and truthful persistence feedback.