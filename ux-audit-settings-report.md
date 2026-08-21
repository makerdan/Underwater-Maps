# BathyScan UX E2E Audit Report — Settings & Admin Tools

**Scope:** Settings page (all tabs, J1–J16) and Admin panel flows.
**Date:** 2026-08-21.
**Audit ref:** Task 4315.
**Mode:** **Report-only** — no application source files were changed. Fix tasks are left as PROPOSED.
**Method:** Code inspection of all Settings section components, AdminPanel, UserAccessSection, GlobalResetFooter, settingsStore, and all relevant API routes (settings, admin, admin-users, me). Prior audit reports ingested for seed carry-forward.

---

## Stack flags confirmed

- `backend: true` — PUT /api/settings, GET /api/settings hydration, /api/me export/delete, /api/admin/* operational and user-management routes.
- `auth: true` — Clerk session, protected routes, admin probe gate, sign-out cleanup.
- `multi-tool: true` — Settings controls wire into 3D viewer, Overview Map, GPS, markers, habitat, tidal, currents, and AI query panels.
- `interactions: true` — inline confirmations, file import/export, admin approve/ban/restore/delete, countdown timer undo.

---

## Summary table

| Severity | New findings | Seeds (re-verified) | Already tracked |
|---|---:|---:|---:|
| High | 2 | 1 | 1 (task #4318) |
| Medium | 5 | 1 | 0 |
| Low | 5 | 0 | 0 |
| **Total** | **12** | **2** | **1** |

---

## Finding index (Critical → Low)

| ID | Journey | Phase | Severity | User-visible failure | Status |
|---|---|---|---|---|---|
| SA-H-001 | J2 Save & sync | 3 (silent failure) | **High** | Back-button navigates away after sync failure — unsaved changes silently lost | New |
| SA-H-002 | J14 Admin users | 10 (feedback) | **High** | Approve and deny rows disappear with zero success feedback | New |
| [SEED F-002] | J1 Navigate Settings | 12 (cross-context) | **High** | Settings two-column layout persists at 375 px — no responsive single-column stack | Re-verified open |
| [tracked] | J16 Admin access | — | **High** | Admin tab causes black screen crash | Task #4318 in progress |
| SA-M-001 | J14 Admin users | 5 (silent failure) | **Medium** | Pending-approvals list load failure has no retry — dead-end error state | New |
| SA-M-002 | J4 Global reset | 11 (data lifecycle) | **Medium** | GlobalResetFooter: no Escape/click-away cancel, no post-reset undo window, no cloud-sync failure feedback | New |
| SA-M-003 | J13 Account | 5 (silent failure) | **Medium** | Account DELETE succeeds but signOut fails → `deletingAccount` never resets, session left alive, user told to "close tab" | New |
| SA-M-004 | J13 Account | 10 (feedback) | **Medium** | exportMsg stale error never cleared between export attempts | New |
| SA-M-005 | J14 Admin users | 8 (preferences) | **Medium** | Ban note textarea has a 2000-char server limit with no visible counter or disclosure | New |
| [SEED F-007] | J2 Save & sync | 2/10 | **Medium** | Settings sync can silently remain stale through prolonged network failure/back-off | Re-verified open |
| SA-L-001 | J1 Navigate Settings | 12 (cross-context) | **Low** | Settings sidebar `overflow: hidden` clips tabs on narrow/mobile viewports | New |
| SA-L-002 | J16 Admin access | 9 (auth) | **Low** | AdminPanel main error and forbidden states have no retry button | New |
| SA-L-003 | J15 Admin ops | 10 (feedback) | **Low** | Skill download error message says "Check server logs" — inappropriate for end users | New |
| SA-L-004 | J14 Admin users | 4 (error/edge) | **Low** | Pending-approvals mini-list caps at server default 50 with no in-UI disclosure | New |
| SA-L-005 | J14 Admin users | 4 (error/edge) | **Low** | AdminPanel casts pending user response as `PendingUser[]` without runtime schema validation | New |

---

## Full findings

### SA-H-001 — Back-button navigates away after sync failure, unsaved settings changes silently lost

**Journey:** J2 (Save & sync)
**Phase:** 3 — Silent failure hunt
**Severity:** High

**Failure:** In `Settings.tsx` `handleBack` (lines 216–232), when the user has unsaved changes (`shouldGuard === true`) the code calls `await flushSync()` inside a `try/catch` that explicitly swallows failures:

```ts
try {
  await flushSync();
} catch {
  // Swallow — user can retry via the sync indicator or section Save.
}
// Navigation fires unconditionally:
window.history.back();  // or setLocation("/")
```

If the PUT /api/settings call fails (network error, 503, rate-limit), the catch comment directs the user to "retry via the sync indicator or section Save" — but by the time those words are read (if they are read at all), the user is already on the previous page. The unsaved changes held in the Zustand store were dirtied but never persisted; the unmount flush fires but is also fire-and-forget (`void flushServerSync()`), again with no user feedback on failure. The user believes they saved and left; in practice a network hiccup silently discards their changes.

**Fix:** In `handleBack`, if `flushSync()` throws, do not navigate. Instead surface a brief inline error ("Couldn't save — check your connection. Leave anyway?") with **two buttons**: "Leave anyway" (navigate without saving) and "Stay & retry" (re-run the save). This matches the established pattern from the "save failed / retry" indicator already visible in the topbar.

---

### SA-H-002 — Admin approve and deny rows disappear with zero success feedback

**Journey:** J14 (Admin – user management)
**Phase:** 10 — UI feedback pass
**Severity:** High

**Failure:** In `AdminPanel.tsx`, the `approve` handler (lines ~260–275) and `deny` handler (lines ~280–295) call `authorizedFetch` and, on success, call `setPendingUsers(prev => prev.filter(...))` to remove the row. No toast, no inline message, no badge change, and no visual transition confirms success. The row simply vanishes. Admin users cannot distinguish "action completed successfully" from "row erroneously disappeared" or a UI glitch. On approve the full `UserAccessSection` updates asynchronously, but its loading/re-fetch is not coupled to the mini-list success state.

Separately, `UserAccessSection.tsx` (the full table) does show per-row in-flight state and error state for all actions, so the two admin surfaces are inconsistent in their feedback quality.

**Fix:** After a successful approve or deny in the mini-list in `AdminPanel`, show a short toast confirmation ("User approved" / "User denied") using the existing `useToast` hook. Keep the row-removal animation. Also add a toast for `UserAccessSection` approve/restore mutations to bring parity with the existing ban/delete feedback.

---

### [SEED F-002] — Settings two-column layout persists at 375 px

**Journey:** J1 (Navigate Settings)
**Phase:** 12 — Cross-context pass
**Severity:** High (carried from prior audit)

**Failure:** `settings/styles.ts` defines `sidebar` with `overflowY: "auto"` but no width breakpoint. The `layout` style uses a flex row (sidebar + content pane) with no `@media` or `isMobile` branch to collapse to a single-column stack at phone widths. At 375 px the sidebar is visible but crushes the content area; users must scroll horizontally to see controls. The tab labels truncate behind the content pane with no visible indicator.

**Re-verify status:** Confirmed open. No code change since the prior audit addressed this path.

**Fix:** In `styles.ts`, add a responsive branch driven by `isMobile` (already available in Settings.tsx) that switches `layout` from `flexDirection: "row"` to `"column"` at phone widths. Collapse the sidebar into a horizontal scrollable tab strip above the content area on mobile (or use the existing `MOBILE_NAV_TABS` list already defined for this purpose). Mobile-specific sidebar overflow must switch to `overflowX: "auto"` / `overflowY: "visible"`.

---

### SA-M-001 — Pending-approvals mini-list load failure is a dead end

**Journey:** J14 (Admin – user management)
**Phase:** 5 — Silent failure hunt
**Severity:** Medium

**Failure:** In `AdminPanel.tsx`, the `PendingApprovalsCard` fetches `GET /api/admin/users/pending-count` and then fetches the list. If the list fetch fails, `setPendingLoadError(true)` renders a generic error message ("Failed to load pending approvals") with no Retry button. The admin is stuck: they cannot re-trigger the fetch without leaving and returning to the Settings page. Contrast with `DataStorageSection`, which consistently shows "Failed to load — Retry" patterns.

**Fix:** Add a Retry button in the `PendingApprovalsCard` error state that calls the list-fetch function. Pattern already established in `DataStorageSection` (lines ~297–304).

---

### SA-M-002 — GlobalResetFooter: no Escape/click-away cancel, no undo window, no cloud-sync feedback

**Journey:** J4 (Global reset)
**Phase:** 11 — Data lifecycle pass
**Severity:** Medium

**Failure:** `GlobalResetFooter.tsx` offers a two-step inline confirmation (button → YES / CANCEL). Issues:

1. **No Escape or click-away cancel.** The YES/CANCEL row has no `onKeyDown` Escape handler and is not a dialog with `role="dialog"`. Keyboard users and accidental openers cannot dismiss without clicking CANCEL.
2. **No post-reset undo.** After clicking YES, `resetAll()` is called synchronously and `setConfirm(false)` hides the confirmation row with no further feedback. There is no "Reset complete — Undo?" window (even 5 seconds like the marker-delete undo). For a destructive action resetting all settings, this is a meaningfully worse UX than the marker-delete flow in the same codebase.
3. **No cloud-sync failure feedback.** The reset triggers store dirty flags and eventually a debounced PUT /api/settings. If that PUT fails, the user has no knowledge that their reset was not persisted to the cloud. The success path is also silent (no confirmation, no "✓ Reset" flash).

**Fix:** (a) Add `onKeyDown` Escape on the confirmation row. (b) After YES, show a "✓ Settings reset — Undo?" banner for ~5 s with an undo action that calls a snapshot-restore. (c) If the debounced PUT fails, surface it through the existing topbar sync indicator (it already does this — document in UI copy that cloud sync follows).

---

### SA-M-003 — Account DELETE: signOut failure leaves session alive with no recovery path

**Journey:** J13 (Account & Privacy)
**Phase:** 5 — Silent failure hunt
**Severity:** Medium

**Failure:** In `AccountSection.tsx`, the account deletion flow (lines ~219–256):

1. Calls `DELETE /api/me` (succeeds → all DB records removed).
2. Calls local state cleanup (clears Zustand store, IDB, localStorage).
3. Calls `await signOut()`.
4. If `signOut()` throws, the catch at line ~249 sets an error message: "Account deleted — but we couldn't sign you out. Close this tab to complete the sign-out."

Problems:
- `deletingAccount` is set to `true` at the start and only reset in the finally block *of the outer account-action handler*, but the inner `signOut` try/catch is a separate block. If the finally of the outer handler is not reached (e.g. because `signOut` throws outside the expected flow), `deletingAccount` stays `true` and the DELETE button remains in "DELETING" state permanently.
- "Close this tab" is an inadequate recovery instruction on mobile browsers that don't surface tab closing prominently.
- The session is still live on the Clerk side, meaning the user (whose DB data is already deleted) can still make authenticated API calls until Clerk's token expires.

**Fix:** In the signOut failure catch, explicitly call `setDeletingAccount(false)` to restore the button state. Replace "close this tab" with a direct "Retry sign-out" button that calls `signOut()` again. Consider adding a `window.location.reload()` fallback link ("or reload the page") since a full reload forces Clerk to re-evaluate the session.

---

### SA-M-004 — exportMsg stale error persists across subsequent export attempts

**Journey:** J13 (Account & Privacy)
**Phase:** 10 — UI feedback pass
**Severity:** Medium

**Failure:** In `AccountSection.tsx`, `exportMsg` is set to an error string on local-export failure (line ~107). On a subsequent export attempt, the local export handler calls `setExportMsg(null)` (line 99) — but only in the local-export handler. The export-all handler (`handleExportAll`) does NOT clear `exportMsg` at the start. If the user tries local export (fails, error shows), then tries export-all, the stale local-export error remains visible alongside the export-all progress/result. The condition rendering `exportMsg` (line ~429) is unconditional on which export triggered it.

**Fix:** Clear `exportMsg` at the start of `handleExportAll` (add `setExportMsg(null)` before the `setExportingAll(true)` call). Also clear it on a successful export of either type — currently `exportMsg` is only set to null at the start of the local export or left as its error value. A successful export should show a positive "✓ Exported" message (currently absent).

---

### SA-M-005 — Ban note textarea has a 2000-char server limit with no visible counter

**Journey:** J14 (Admin – user management)
**Phase:** 8 — Settings & preferences pass
**Severity:** Medium

**Failure:** In `UserAccessSection.tsx` (line ~322), the ban note textarea has `maxLength={2000}`. This is the correct client enforcement of the server-side 2000-char cap (validated in `admin-users.ts`). However:

1. No character counter is rendered ("0 / 2000" or remaining counter). Admins writing longer investigation notes cannot see how close they are to the limit.
2. When the textarea silently truncates input at 2000 chars (browser `maxLength` behavior), the admin gets no explanation.
3. The sublabel/placeholder does not disclose the limit.

**Fix:** Add a live character counter below the textarea (`{banNote.length} / 2000`) that turns amber/red when the limit is approached (e.g. ≥ 1800 chars). This is a small rendering addition alongside the existing textarea.

---

### [SEED F-007] — Settings sync can silently remain stale during prolonged failure/back-off

**Journey:** J2 (Save & sync) / J3 (Cloud sync failure & retry)
**Phase:** 2/10
**Severity:** Medium (carried from prior audit)

**Failure:** `useServerSettingsSync` implements exponential back-off after PUT failures. During the back-off window the topbar shows "save failed / retry" but the retry button manually flushes only; the debounce-and-retry cycle runs in the background on an unknown schedule. If the user closes and reopens Settings within the back-off window, the indicator briefly shows "synced to cloud" (because `anyDirty` is false on initial load of a new Settings mount, before the dirty flags propagate from the pending debounce). A user who saves settings, sees "save failed", dismisses Settings, and reopens Settings 10 seconds later may see "synced to cloud" even though the last write hasn't landed yet.

**Re-verify status:** Confirmed open. The `syncStatus.lastSyncFailed` flag is persisted across Settings mounts via the external store, so the error indicator does re-appear when the subscription reconnects — but there is a brief window between mount and subscription hydration where the stale "synced" state is shown.

**Fix:** This requires the sync status to be a module-level singleton that initializes in an error/saving state when there is an outstanding dirty flush, rather than defaulting to "synced" before the subscription callback fires. Short-term: initialize `cloudState` on mount from `getSettingsSyncStatus()` synchronously (already available via the external-store API) rather than waiting for the first subscription callback.

---

### SA-L-001 — Settings tab sidebar clipped on mobile — overflow: hidden

**Journey:** J1 (Navigate Settings)
**Phase:** 12 — Cross-context pass
**Severity:** Low

**Failure:** `settings/styles.ts` line 88 sets `overflow: "hidden"` on the main layout element. The sidebar at the same level has `overflowY: "auto"` but is constrained by the parent's `overflow: hidden`. On mobile viewports, if the settings tab list is taller than the viewport, tabs at the bottom of the list (Accessibility, Account & Privacy, Admin) are clipped with no scroll indicator. This is partially mitigated by the two-column layout flaw (SA-H-001 / SEED F-002) making the sidebar visible at all — fixing the responsive layout will also need to address sidebar scrollability.

**Fix:** Addressed together with SEED F-002 responsive layout fix: change `overflow: "hidden"` to `overflow: "clip"` on the outer container (prevents scroll bleed without breaking the sidebar scroll), and ensure the sidebar scrolling context is correctly established after the responsive layout change.

---

### SA-L-002 — AdminPanel main error/forbidden card has no retry

**Journey:** J16 (Admin access gate)
**Phase:** 9 — Auth & session pass
**Severity:** Low

**Failure:** In `AdminPanel.tsx`, when the initial stats fetch fails (`adminStatus === "error"`) or returns 403 (`adminStatus === "forbidden"`), an error card is rendered with a static message. There is no retry button for the error state (the forbidden state correctly shows no retry since access is denied). In the error case (e.g. transient 503 from the upscale-cache-stats endpoint), the admin must leave Settings and return to trigger a fresh fetch.

**Fix:** For `adminStatus === "error"`, render a Retry button that calls the stats-fetch function (passing `adminProbeAttempt` increment or a dedicated refetch trigger). The forbidden state should remain static (correct behavior).

---

### SA-L-003 — Skill download error message "Check server logs" — inappropriate for end users

**Journey:** J15 (Admin – operational tools)
**Phase:** 10 — UI feedback pass
**Severity:** Low

**Failure:** In `AdminPanel.tsx` (skill download error state, lines ~454–458), the error message rendered to the admin is "Failed to download skill package. Check server logs." Admin users are not necessarily developers with server log access. The error provides no actionable recovery path.

**Fix:** Replace with "Failed to download — try again. If it keeps failing, the skill file may be missing from the deployment." Add a Retry button to re-trigger the download. Remove the "Check server logs" phrasing from user-facing text.

---

### SA-L-004 — Pending-approvals mini-list caps at server default 50 with no in-UI disclosure

**Journey:** J14 (Admin – user management)
**Phase:** 4 — Error & edge case pass
**Severity:** Low

**Failure:** The admin-users route `/api/admin/users` defaults to `limit=50` (validated/capped in `admin-users.ts`). The `PendingApprovalsCard` in `AdminPanel.tsx` fetches with default parameters and does not display how many total pending users exist nor whether the list is paginated. If there are >50 pending users, admins silently see a truncated list with no indication. The full `UserAccessSection` supports keyset pagination with LOAD MORE, but the mini-list does not.

**Fix:** Include the total count in the mini-list header ("X pending approvals, showing first 50 — open User Access for full list" when count > shown list length). Or remove the mini-list's fetch and rely solely on the full UserAccessSection's paginated table.

---

### SA-L-005 — Pending users cast to `PendingUser[]` without runtime schema validation

**Journey:** J14 (Admin – user management)
**Phase:** 4 — Error & edge case pass
**Severity:** Low

**Failure:** In `AdminPanel.tsx`, the pending user list response body is cast with `as PendingUser[]` (no runtime Zod/schema parse). Malformed or unexpected server responses (e.g. during migration or a server schema mismatch) can silently render blank rows or generate URL-encoded invalid IDs in approve/deny mutation requests. The `admin-users.ts` server responses do have Zod-validated response schemas, but the client does not use `@workspace/api-zod` types for this particular endpoint.

**Fix:** Parse the `/api/admin/users` response through the generated `AdminUsersListResponse` Zod schema (or equivalent) before setting state. If parsing fails, show the same load-error UI rather than silently rendering malformed rows.

---

## Journey coverage summary

| # | Journey | Result | Notes |
|---|---|---|---|
| J1 | Navigate Settings: open, tab-switch, `?tab=` deep-link, back-navigate | **FINDING** | SA-H-001 (back-button data loss), SA-L-001 (sidebar clip) |
| J2 | Save & cloud sync: dirty state, explicit save, reload, verify persistence | **FINDING** | SA-H-001 (back data loss), SEED F-007 |
| J3 | Cloud sync failure & retry | **PASS with seed** | Retry UI present; SEED F-007 covers stale initial state |
| J4 | Global reset: two-step confirmation, cleared scope, sync after reset | **FINDING** | SA-M-002 (no undo, no Escape, no feedback) |
| J5 | General tab: water type, units, depth unit, temp unit, defaults, replay tour | **PASS** | All handlers wired; clearStaleDefaultMapLoad fires on water-type change |
| J6 | Visuals & Perf tab: toggles, sliders, intertidal datums | **PASS** | Antialiasing reload-hint shown; clampSlider guards all numeric inputs |
| J7 | Depth Banding (Palette) tab: palette selection, section save/reset, contours | **PASS** | Separate PaletteSection save/reset path correct; SectionActionsRow wired |
| J8 | Navigation tab: speed tier, sensitivities, FOV, spawn, joystick, key bindings | **PASS** | findBindingConflicts wired; allDefault guard on Reset All Key Bindings |
| J9 | Display & Overlays tab: HUD controls, overlays, format options | **PASS** | isMobile branch correctly hides moved-to-ChartMap controls on desktop |
| J10 | Map Layers tab: marker, trail, tidal, currents | **PASS** | nearestGpsInterval normalization and 360°→0° correction both wired |
| J11 | Marker Symbols tab: symbol palette selection | **PASS** | Mode-aware section list, other-mode collapsed details, legacy section |
| J12 | Data & Storage tab: terrain cache, enhanced image cache, offline packs | **PASS** | clearingAnyRef mutex present; per-pack-id lock; unmount guard; retry patterns |
| J13 | Account & Privacy tab: export, import, delete-all-markers, delete account | **FINDING** | SA-M-003 (signOut failure), SA-M-004 (stale exportMsg) |
| J14 | Admin – user management: approve, deny/ban, restore, delete | **FINDING** | SA-H-002 (no success feedback), SA-M-001 (pending retry), SA-M-005 (ban note), SA-L-004, SA-L-005 |
| J15 | Admin – operational tools: bucket monitor, diff, rate-limit, cache stats, email, skill | **FINDING** | SA-L-003 (skill error wording) |
| J16 | Admin access gate: non-admin 403, probe error, tab normalization | **FINDING** | SA-L-002 (no retry), tracked task #4318 (crash) |

---

## Phase coverage notes

- **Phase 0 (seed ingestion):** F-002 (Settings responsive) and F-007 (sync staleness) re-verified and carried as open seeds. SEED F-008 (upload queue lost on restart) and mobile overlay/occlusion findings are out of scope per task definition.
- **Phase 3 (silent failures):** All non-empty catches in Settings section components verified. handleBack catch (SA-H-001) and account signOut failure (SA-M-003) are the critical findings. Tab-switch flush is void-and-catch-to-indicator — acceptable since the user stays on Settings. Unmount flush failure is fire-and-forget — acceptable as a best-effort.
- **Phase 5 (navigation & dead ends):** Unknown `?tab=` correctly falls back to DEFAULT_TAB ("visuals"). Admin tab normalizes to DEFAULT_TAB on access denied. `window.history.back()` falls back to `setLocation(basePath + "/")` when history length ≤ 1. All tab link IDs in NAV_TABS / MOBILE_NAV_TABS / ADMIN_NAV_TAB are valid values of the `Tab` union.
- **Phase 9 (auth & session):** Admin probe correctly distinguishes 401/403 (→ "denied") from network error (→ "error") and 2xx (→ "allowed"). Sign-out on mobile is `void signOut()` — no catch or user feedback on failure (low risk: Clerk SDK handles most sign-out errors internally).
- **Phase 10 (UI feedback):** Save flash 2 s confirmed. In-flight disabling for all admin row actions confirmed in UserAccessSection. Operational card REFRESH disabled during load.
- **Phase 11 (data lifecycle):** Delete-all-markers undo timer confirmed at UNDO_DELETE_WINDOW_MS = 5000 ms. Delete-account clears local state (Zustand, IDB) before sign-out. Clear All Cache scope matches UI disclosure note; offline packs, help content, and enhanced images are excluded per PROTECTED_CACHE_PREFIX and CLEAR_ALL_EXACT_CACHE_NAMES logic.
- **Phase 12 (cross-context):** SEED F-002 (375 px two-column layout) re-verified open. Admin panel table at 480 px: UserAccessSection uses `overflowX: "auto"` with `minWidth: 680` — correctly scrollable. Settings tab strip `overflow: hidden` clips on mobile (SA-L-001). Ban note char counter absent (SA-M-005).

---

## Prior seed disposition

| Seed | Status | Notes |
|---|---|---|
| [SEED F-002] Settings responsive layout at 375 px | **Open** | Re-verified; no fix merged. New fix task proposed. |
| [SEED F-007] Settings sync staleness | **Open** | Re-verified; lastSyncFailed flag persists across mounts but brief "synced" flash on remount still present. Fix task proposed. |
| [SEED F-008] Upload queue lost on API restart | **Out of scope** | Architectural; deferred per task definition. |
| Mobile overlay/occlusion (ux-audit-mobile-report.md) | **Out of scope** | Not in scope per task definition. |

---

*Report-only audit: no application code, styles, configurations, or tests were changed. All findings are in PROPOSED fix tasks — the user confirms or edits before any implementation begins.*
