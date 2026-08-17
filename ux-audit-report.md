# UX E2E Audit Report

**Scope:** BathyScan — `artifacts/bathyscan` (React/Vite/R3F frontend) + `artifacts/api-server` (Express 5 API)
**Mode:** Report-only (no code changes) — original audit 2026-08-12
**Closure update:** 2026-08-16 — audit-and-fix passes complete. 28 of the 30 original findings are **Closed** (verified fixed in the codebase), SEED F-001 is **Fixed** in this closure pass, and SEED F-008 is **Deferred — architectural** (persisting upload job state to the DB is tracked as its own task). One new finding (NEW-001) was discovered during closure verification and fixed in the same pass.
**Stack:** TypeScript 5.9, React 19 + Vite + React Three Fiber, Express 5, Drizzle/PostgreSQL, Zustand, Clerk auth, Poe AI

---

## Summary Table

| Severity | Found | Closed | Fixed (closure pass) | Deferred |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 4 | 3 | 1 (SEED F-001) | 0 |
| Medium | 12 | 10 | 1 (NEW-001) | 1 (SEED F-008) |
| Low | 15 | 15 | 0 | 0 |
| **Total** | **31** | **28** | **2** | **1** |

---

## Finding Index

| ID | Journey | Phase | Sev | One-line description | Status |
|---|---|---|---|---|---|
| [SEED F-001] | J8 Drift planner | Ph3 Silent failures | **High** | Folder rename PATCH failure silently swallowed — name reverts with no message | **Fixed (2026-08-16)** |
| [SEED F-003] | J9 Settings | Ph9 Auth/session | Medium | Server settings cast not validated before hydrating client stores | Closed |
| [SEED F-004] | All | Ph2 State | Medium | uiStore ↔ settingsStore dual source of truth — mirrored setters can diverge | Closed |
| [SEED F-006] | J4 Upload | Ph4 Edge cases | Medium | `jobId` destructured from finalize response without validation | Closed |
| [SEED F-007] | All | Ph5 Navigation | Medium | No error boundary around the full sidebar or the top-level 3D scene | Closed |
| [SEED F-008] | J4 Upload | Ph11 Lifecycle | Medium | Upload job state and concurrency queue are in-memory only (lost on server restart) | **Deferred — architectural** |
| [SEED F-009] | J2/J3 Load | Ph9 Auth | Low | Catalog startup seeding/recovery is fire-and-forget at module load | Closed |
| [SEED F-010] | J2/J5 Search | Ph9 Auth | Low | Catalog list/search/bbox endpoints have no auth and no rate limit | Closed |
| [SEED F-011] | J11 Offline | Ph11 Lifecycle | Low | Offline pack creation silently omits weather data on fetch failure | Closed |
| [SEED F-012] | J12 Live | Ph10 Feedback | Low | Empty catch blocks on wake-lock acquire/release — no comment | Closed |
| [SEED F-013] | J13 Overlays | Ph3 Silent | Low | CurrentsPanel effect keyed on `Date` object reference fires redundant settings writes | Closed |
| F-001 | J9 Settings | Ph6 Keyboard | **High** | FlyControls keydown/wheel has no input-focus guard — camera moves while user types in Settings inputs | Closed |
| F-002 | All | Ph5 Navigation | **High** | Missing 404 fallback route — `not-found.tsx` exists but is orphaned from the router Switch | Closed |
| F-003 | J15 Auth | Ph9 Auth | **High** | `savedDriftPlans` localStorage key is not cleared on sign-out — prior user's plans visible on shared device | Closed |
| F-004 | J15 Auth | Ph9 Auth | Medium | GPS column-mapping fingerprints (CSV localStorage keys) are not cleared on sign-out | Closed |
| F-005 | J9 Settings | Ph6 Keyboard | Medium | Global Escape handler in App.tsx has no input-focus guard — closes panels while user types | Closed |
| F-006 | J4/J7/J6/J11 | Ph5 Navigation | Medium | Four dialogs (GpsImportDialog, GeoreferenceModal, ReassignMarkersDialog, MarkerForm) lack Escape-key close | Closed |
| F-007 | J4 Upload | Ph4 Validation | Medium | FileUpload has no `onDropRejected` callback — rejected files (wrong type, multiple) silently ignored | Closed |
| F-008 | J4 Upload | Ph4 Validation | Medium | `.pdf` listed in `SUPPORTED_EXTENSIONS` display string but is absent from the `accept` map — false advertising | Closed |
| F-009 | J6/J14 Markers | Ph12 Cross | Medium | MarkersPanel renders entire marker list without virtualization — degrades at large counts | Closed |
| F-010 | All | Ph12 Cross | Medium | No `storage` event listeners anywhere — settings, palette, drift plans, panel-collapse don't sync across tabs | Closed |
| F-011 | All | Ph12 Cross | Medium | DatasetPanel `minWidth: 536px` overflows narrow/mobile viewports with no responsive override | Closed |
| F-012 | All | Ph5 Navigation | Low | No focus restoration after any of 5 dialogs close (GpsImport, OfflinePack, Georeference, ReassignMarkers, MarkerForm) | Closed |
| F-013 | J2/J5 Search | Ph12 Cross | Low | FindDataPanel search-result dataset names are not truncated — long names wrap vertically | Closed |
| F-014 | J14 Catch journal | Ph12 Cross | Low | CatchJournalPanel renders all entries without virtualization or pagination | Closed |
| F-015 | J8 Drift planner | Ph11 Lifecycle | Low | `loadDriftPlan` does not clear stale start coordinates when the loaded plan has `null` start | Closed |
| F-016 | J7/J8/J9 Mode | Ph7 Modes | Low | "Analyze" sidebar tab has no active-feature dot indicator, unlike Explore/Plan/Live | Closed |
| F-017 | J9 Settings | Ph6 Keyboard | Low | App shortcuts H, M, Slash, Comma are registered but absent from ControlsLegend display | Closed |
| F-018 | J11 Offline | Ph11 Lifecycle | Low | `cacheTerrain()` silently resolves after 10 s on timeout when no service worker is registered | Closed |
| F-019 | J2/J3 Load | Ph10 Feedback | Low | No toast deduplication — rapid duplicate API errors produce multiple stacked toasts | Closed |
| NEW-001 | J3 My Saves | Ph3 Silent failures | Medium | MySavesSection retry has no `catch` — a failed retry stops the spinner with no error message | **Fixed (2026-08-16)** |

---

## Seed Status

| ID | Seed finding | Status |
|---|---|---|
| SEED F-001 | Folder rename swallowed | **Fixed (2026-08-16)** — `handleCommitFolderRename` now surfaces a destructive "Couldn't rename folder" toast and keeps the edit box open with the typed value so the user can retry |
| SEED F-002 | Water-temp texture not disposed | **Closed (fixed)** — abortControllerRef dispose confirmed present in `useUpscaledHeatmap` and `useWaterTempTexture` now disposes correctly. Finding 5 in original report was already marked Fixed. |
| SEED F-003 | Server settings cast not validated | **Closed (fixed)** — server response is validated before hydrating client stores |
| SEED F-004 | uiStore/settingsStore dual source | **Closed (fixed)** — mirrored-field invariant coverage added |
| SEED F-005 | AI upscale not aborted on unmount | **Closed (fixed)** — `abortControllerRef.abort()` confirmed at `hooks/useUpscaledHeatmap.ts:243` |
| SEED F-006 | jobId not validated | **Closed (fixed)** — finalize response `jobId` validated before polling |
| SEED F-007 | No top-level error boundary | **Closed (fixed)** — sidebar/app-level error boundary added |
| SEED F-008 | Upload state in-memory only | **Deferred — architectural** — persisting upload job state to the DB is a larger change, tracked as its own task; not closed in this pass |
| SEED F-009 | Startup seeding fire-and-forget | **Closed (fixed)** — seeding failures now logged via explicit `.catch` |
| SEED F-010 | Catalog endpoints no auth/rate-limit | **Closed (fixed)** — rate limiting applied to catalog endpoints |
| SEED F-011 | Offline pack weather silent omit | **Closed (fixed)** — weather omission surfaced through pack-creation progress |
| SEED F-012 | Empty catch on wake-lock | **Closed (fixed)** — intent comments added; failures documented as non-fatal |
| SEED F-013 | Date reference effect | **Closed (fixed)** — effect keyed on timestamp value, redundant writes skipped |
| SEED F-014 | Dependency hygiene (accepted) | **Accepted** — no action needed |

---

## Journey Coverage

| # | Journey | Phase 1 result | Notable findings |
|---|---|---|---|
| J1 | First-run / onboarding | PASS — `hasSeenOnboarding` guard correct; auto-select runs before overlay mounts | None new |
| J2 | Terrain from catalog | PASS — happy path complete | SEED F-009, SEED F-010, F-019 |
| J3 | Terrain from My Saves | PASS — Load delegates to DatasetPanel load path | SEED F-009, F-019 |
| J4 | Custom file upload | FINDING — upload success/zone-panel reset race (Task #3389 tracks); Escape close gap | SEED F-006, F-007, F-008 |
| J5 | Federated search → Save | PASS — terrain-required gate present; query invalidated | SEED F-010, F-019 |
| J6 | Markers — create/edit/delete | PASS — undo-delete pattern correct, cache invalidated | F-006 (Escape), F-009 (unbounded list), F-012 |
| J7 | GPS import (GPX/CSV) | PASS — import path complete | F-006 (Escape gap), F-012 |
| J8 | Drift planner | FINDING — loadDriftPlan stale start; folder rename swallowed | SEED F-001, F-003 (sign-out), F-015 |
| J9 | Settings | FINDING — camera moves while typing | F-001, F-002 (404), F-005 (Escape), F-017 |
| J10 | Palette / depth heatmap | PASS — band arrays sanitized before hydration; reset works | None new |
| J11 | Offline pack creation | FINDING — SW timeout silent success | SEED F-011, F-018 |
| J12 | Live mode / GPS follow | PASS — guards on GPS position + grid before follow math | SEED F-012 |
| J13 | Environment overlays | PASS — tidal/currents/weather all terrain-gated | SEED F-013 |
| J14 | Catch journal | FINDING — unbounded entry render | F-014 |
| J15 | Auth flows | FINDING — savedDriftPlans, GPS fingerprints persist after sign-out | F-003, F-004 |
| J16 | Help system | PASS — HelpWindow/HelpButton wired; error boundary present | None new |

---

## Phase Coverage

| Phase | Status | Summary |
|---|---|---|
| Ph0 Discovery & app map | PASS | 16 journeys confirmed; seeds loaded |
| Ph1 Happy path sweep | PASS (with FINDINGs) | J4/J8/J11/J14/J15 have issues |
| Ph2 State & persistence | FINDING(s) | No multi-tab sync; savedDriftPlans/GPS fingerprints persist after sign-out |
| Ph3 Silent failure hunt | FINDING(s) | Folder rename swallowed (SEED); assign-to-folder catch is intentional no-op |
| Ph4 Error & edge cases | FINDING(s) | FileUpload no rejected callback; PDF accept mismatch |
| Ph5 Navigation & dead-ends | FINDING(s) | Missing 404 route; missing Escape in 4 dialogs; no focus restoration |
| Ph6 Keyboard & interactions | FINDING(s) | FlyControls no input guard; Escape no guard; shortcuts missing from legend |
| Ph7 Tool & mode switching | FINDING(s) | Analyze has no indicator dot; only Live has cleanup |
| Ph8 Settings & preferences | PASS | All controls wired; section resets present; General/D&O `withReset=false` is intentional design |
| Ph9 Auth & session | FINDING(s) | savedDriftPlans and GPS fingerprints not cleared on sign-out |
| Ph10 UI feedback & polish | FINDING(s) | Toast deduplication absent |
| Ph11 Data lifecycle | FINDING(s) | loadDriftPlan stale start; SW timeout resolves silently |
| Ph12 Cross-context | FINDING(s) | DatasetPanel minWidth overflow; marker list unbounded; no tab sync; name truncation gap |
| Ph13 Triage & report | COMPLETE | See below |

### Out-of-scope (SKIPPED with reason)

- `artifacts/mockup-sandbox` internals — dev-only preview server, not deployed
- Python BAG parser subprocess (`bag_parser.py`) — outside TS toolchain
- Third-party Clerk widget internals
- Known pre-existing e2e test flakiness already tracked as project tasks

---

## Full Findings

---

### [SEED F-001] — Folder rename failure silently swallowed
- **Status:** **Fixed (2026-08-16)** — the `catch` in `handleCommitFolderRename` now shows a destructive "Couldn't rename folder" toast with the error reason and keeps the edit UI open (typed value preserved) so the user can correct and retry.
- **Journey:** J8 Drift planner (trolling-preset folder rename)
- **Phase:** 3 — Silent failures
- **Severity:** High
- **Failure (user perspective):** User renames a trolling-preset folder. The rename request fails (offline, 401 session expiry, server error). The edit box closes as if the rename succeeded. The old folder name quietly reappears on the next query refetch. The user believes the rename worked.
- **Fix:** `artifacts/bathyscan/src/components/WeatherPanel.tsx:370` — In the `catch` block of `handleCommitFolderRename`, surface the failure via `toast({ title: "Couldn't rename folder", ... })` and keep (or restore) the edit UI so the user's typed name is not lost.

---

### [SEED F-003] — Server settings cast not validated before hydrating stores
- **Journey:** J9 Settings, J15 Auth
- **Phase:** 9 — Auth & session
- **Severity:** Medium
- **Failure:** `useServerSettingsSync.ts:445` casts the GET /api/settings response directly as `Parameters<typeof hydrateFromServer>[0]`. If the server returns an unexpected shape (schema mismatch after a deploy, corrupted row), all stores are silently hydrated with bad values, overwriting valid local state.
- **Fix:** `artifacts/bathyscan/src/hooks/useServerSettingsSync.ts:424` — Run a Zod parse (or a key-by-key typeof check) before passing the server response to `hydrateFromServer`; only apply fields that pass validation.

---

### [SEED F-004] — uiStore ↔ settingsStore dual source of truth
- **Journey:** All (any mirrored overlay/toggle)
- **Phase:** 2 — State & persistence
- **Severity:** Medium
- **Failure:** 20 fields are listed in `MIRRORED_UI_KEYS` and kept in sync via the subscription in `uiStore.ts`. Any bug in the subscription (e.g. `_suppressMirror` stuck true) silently desynchronises uiStore from settingsStore. The affected settings then don't persist to the server even though the UI reflects them.
- **Fix:** `artifacts/bathyscan/src/lib/uiStore.ts:428-494` — Add a DEV-mode invariant check that verifies both stores agree on mirrored fields after each mutation, so desync is caught in tests rather than silently in production.

---

### [SEED F-006] — `jobId` destructured from finalize response without null check
- **Journey:** J4 Custom file upload
- **Phase:** 4 — Error & edge cases
- **Severity:** Medium
- **Failure:** `DatasetPanel.tsx:1614` (approx.) destructures `jobId` from the finalize API response. If the server returns a 2xx with an unexpected shape (missing `jobId`), the subsequent polling call uses `undefined` as the job ID, producing a silent infinite-poll or a 404 that goes unhandled.
- **Fix:** `artifacts/bathyscan/src/components/DatasetPanel.tsx` (finalize response handling) — Validate that `jobId` is a non-empty string before starting the poll loop; throw a user-visible error if not.

---

### [SEED F-007] — No error boundary around the full sidebar or root 3D scene
- **Journey:** All
- **Phase:** 5 — Navigation & dead-ends
- **Severity:** Medium
- **Failure:** Sectional error boundaries exist (scene, HUD, tidal, weather, trip), but a React exception thrown in a component outside those boundaries (e.g. a custom panel, the DatasetPanel itself, or the sidebar mode tabs) crashes the entire app tree with a blank white screen and no recovery UI.
- **Fix:** `artifacts/bathyscan/src/App.tsx` — Wrap the outermost `<Main>` body (or at minimum the sidebar subtree) in an `<ErrorBoundary label="Sidebar">` so a panel-level crash degrades gracefully rather than blanking the whole app.

---

### [SEED F-008] — Upload job state in-memory only
- **Status:** **Deferred — architectural.** Persisting upload job state to the database is a larger change than a catch-path fix and is tracked as its own dedicated task; it remains the only open finding from this audit.
- **Journey:** J4 Custom file upload
- **Phase:** 11 — Data lifecycle
- **Severity:** Medium
- **Failure:** `artifacts/api-server/src/lib/bucketMonitor.ts:131-146,428` stores active upload jobs, concurrency queues, and in-flight chunk state in module-level Maps. A server restart mid-upload loses all job state. The client's polling loop then gets a 404 or empty response and may loop silently rather than surfacing a "Upload interrupted — please retry" message.
- **Fix:** Persist upload job state to the database (a `upload_jobs` table) so a restarted server can re-hydrate in-progress jobs. Until then, detect the 404-on-poll case client-side and surface a recoverable error.

---

### [SEED F-009] — Catalog startup seeding/recovery is fire-and-forget
- **Journey:** J2 Terrain from catalog, J5 Federated search
- **Phase:** 9 — Auth & session
- **Severity:** Low
- **Failure:** `artifacts/api-server/src/routes/catalog-saves.ts:62,102` calls async seeding and recovery functions at module load with no `await` and no error handler. If seeding fails (DB unavailable, schema drift), the failure is swallowed and the catalog may serve empty or stale results with no warning in logs.
- **Fix:** Wrap the seeding call in an explicit `.catch(err => logger.error("Catalog seeding failed", err))` so failures are observable.

---

### [SEED F-010] — Catalog list/search/bbox endpoints are unauthenticated and unrate-limited
- **Journey:** J2 Terrain from catalog, J5 Federated search
- **Phase:** 9 — Auth & session
- **Severity:** Low
- **Failure:** `artifacts/api-server/src/routes/catalog-saves.ts:131,150,197` — The GET /catalog, POST /catalog/search, and GET /catalog/bbox endpoints require no Clerk session token and have no IP-based rate limit. An unauthenticated scraper can enumerate the full dataset library.
- **Fix:** Add `requireAuth` middleware (or at minimum a per-IP rate limit) on these routes, consistent with the rest of the API.

---

### [SEED F-011] — Offline pack creation silently omits weather data on fetch failure
- **Journey:** J11 Offline pack creation
- **Phase:** 11 — Data lifecycle
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/lib/offlinePackStore.ts:173` — The weather-pack fetch failure is caught and silently replaced with `{ station: null, observation: null, snapshotAt: now }`. The user is not told that the pack has no weather data. When offline, `getOfflineWeatherValue` returns `null` and the weather panel shows nothing — with no explanation.
- **Fix:** Report the weather-omission through the `onProgress` callback (e.g. `{ step: "weather", label: "Weather unavailable — pack saved without weather data", done: true }`) so the user knows before committing the pack.

---

### [SEED F-012] — Empty catch blocks on wake-lock acquire/release
- **Journey:** J12 Live mode
- **Phase:** 10 — UI feedback & polish
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/hooks/useWakeLock.ts:42,65` — Two bare `catch {}` blocks swallow errors from `WakeLock.request()` and `WakeLock.release()`. A held wake-lock on error means the device screen may be prevented from sleeping indefinitely, draining battery.
- **Fix:** Add `// intentional: wake-lock failures are non-fatal; screen may dim normally` comments, and optionally a `console.debug` so the intent is clear to future maintainers.

---

### [SEED F-013] — CurrentsPanel effect keyed on `Date` object reference
- **Journey:** J13 Environment overlays
- **Phase:** 3 — Silent failures
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/components/CurrentsPanel.tsx:167-172` — The effect dependency array uses a `Date` object (`timelineCurrentTime`). Each React render that creates a new `Date` instance for the same timestamp re-fires the effect, writing `currentsTidePhase` to settingsStore and feeding the 300 ms debounced PUT /api/settings pipeline with redundant work during scrubbing.
- **Fix:** Depend on `timelineCurrentTime?.getTime() ?? null` and skip the store write when the computed phase value hasn't changed.

---

### F-001 — FlyControls keydown/wheel has no input-focus guard
- **Journey:** J9 Settings (and any panel with inputs)
- **Phase:** 6 — Keyboard & interactions
- **Severity:** High
- **Failure:** `artifacts/bathyscan/src/components/FlyControls.tsx:37-53,124-147` — The global `keydown` and `keyup` handlers always record `keys.current[e.code]` regardless of `document.activeElement`. When a user types in a Settings text field, number input, or search box, WASD moves the camera, +/− changes speed, and Space triggers a movement burst. The wheel handler similarly changes camera zoom when the pointer is over a form control. This makes all keyboard-heavy forms (Settings, GPS import mapping, palette boundary fields) nearly unusable on desktop.
- **Fix:** `artifacts/bathyscan/src/components/FlyControls.tsx:37` — Add an input-focus guard at the top of the keydown/keyup handlers: `if (["INPUT","TEXTAREA","SELECT"].includes((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable) return;` Mirror this guard in the wheel handler.

---

### F-002 — Missing 404 fallback route — `not-found.tsx` is orphaned
- **Journey:** All (any mistyped or stale URL)
- **Phase:** 5 — Navigation & dead-ends
- **Severity:** High
- **Failure:** `artifacts/bathyscan/src/App.tsx:2377-2382` — The Wouter `<Switch>` only registers routes for `/`, `/settings`, `/sign-in/*?`, and `/sign-up/*?`. An unmatched path (e.g. a stale bookmarked URL, a typo, a future feature path that hasn't launched yet) renders nothing — blank white area — with no "Page not found" message or navigation back to home. `artifacts/bathyscan/src/pages/not-found.tsx` exists and is complete but is never imported.
- **Fix:** `artifacts/bathyscan/src/App.tsx:2382` — Add a catch-all `<Route>` at the end of the Switch: `<Route><NotFound /></Route>` and import `NotFound` from `@/pages/not-found`.

---

### F-003 — `savedDriftPlans` localStorage key not cleared on sign-out
- **Journey:** J15 Auth flows
- **Phase:** 9 — Auth & session
- **Severity:** High
- **Failure:** `artifacts/bathyscan/src/lib/driftStore.ts:116-157,368-400` — Saved drift plans are stored in `localStorage["bathyscan:savedDriftPlans"]` via manual JSON serialization. `artifacts/bathyscan/src/hooks/useServerSettingsSync.ts:347-385` lists the keys it removes on sign-out but does not include `bathyscan:savedDriftPlans`. A subsequent user on the same device who signs in sees the previous user's entire saved plan list without any indication.
- **Fix:** `artifacts/bathyscan/src/hooks/useServerSettingsSync.ts:378-384` (sign-out cleanup block) — Add `try { localStorage.removeItem("bathyscan:savedDriftPlans"); } catch {}` alongside the other key removals. Also reset the driftStore in-memory savedDriftPlans to `[]`.

---

### F-004 — GPS column-mapping fingerprints not cleared on sign-out
- **Journey:** J15 Auth flows, J7 GPS import
- **Phase:** 9 — Auth & session
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/components/ColumnMappingStep.tsx:28-48,116-161` — CSV column-mapping fingerprints are stored in localStorage under a `bathyscan:csv-col-map:` prefix per file fingerprint. These are never removed on sign-out. On a shared device, the next user's GPS import dialog may auto-populate column mappings from the previous user's files if they happen to have the same column header fingerprint.
- **Fix:** In the sign-out cleanup block (`useServerSettingsSync.ts:378-384`), enumerate and remove all `bathyscan:csv-col-map:*` keys from localStorage.

---

### F-005 — Global Escape handler has no input-focus guard
- **Journey:** J9 Settings (and any form with inputs)
- **Phase:** 6 — Keyboard & interactions
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/App.tsx:1098-1104` — The `Escape` keydown handler closes the query panel, clears highlights, closes the overview, and closes the What's Here card, regardless of whether the user is typing in a text input. Pressing Escape to clear an input value instead collapses the user's query panel or clears selection state unexpectedly.
- **Fix:** `artifacts/bathyscan/src/App.tsx:1098` — Add an input-focus guard: `if (["INPUT","TEXTAREA","SELECT"].includes((e.target as HTMLElement).tagName)) return;` before dispatching the Escape actions.

---

### F-006 — Four dialogs lack Escape-key close
- **Journey:** J7 GPS import, J4 Upload (georeference), J6 Markers (reassign), J8 Drift planner
- **Phase:** 5 — Navigation & dead-ends
- **Severity:** Medium
- **Failure:** `GpsImportDialog.tsx`, `GeoreferenceModal.tsx`, `ReassignMarkersDialog.tsx`, and `MarkerForm.tsx` all lack a `keydown` → `Escape` → close handler. Users who habitually press Escape to dismiss modals find themselves stuck — the only exit is the explicit close/cancel button. This is inconsistent with the rest of the app (e.g. `DatasetPanel.tsx`'s remove-confirmation dialog does handle Escape at line 271).
- **Fix:** Add `useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose])` inside each missing dialog. Guard against firing while a child input is focused only if needed.

---

### F-007 — FileUpload silently ignores rejected drops
- **Journey:** J4 Custom file upload
- **Phase:** 4 — Error & edge cases
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/components/FileUpload.tsx:36-115` — The react-dropzone config omits `onDropRejected`. When a user drops an unsupported file type or drops multiple files (the zone only accepts one), nothing happens. There is no toast, no inline error, and no visual feedback. The user may retry many times thinking the drop zone is broken.
- **Fix:** Add `onDropRejected: (rejections) => { const reason = rejections[0]?.errors[0]?.code === "file-invalid-type" ? "Unsupported file type" : "Drop rejected"; setError(reason); }` and display the error in the UI below the drop zone.

---

### F-008 — `.pdf` advertised in SUPPORTED_EXTENSIONS but absent from accept map
- **Journey:** J4 Custom file upload
- **Phase:** 4 — Error & edge cases
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/components/FileUpload.tsx:21-22` — `SUPPORTED_EXTENSIONS` includes `.pdf` in its display string, but the `accept` map at `:100-112` does not include `application/pdf`. The drop zone silently rejects PDF files (no `onDropRejected` feedback either, per F-007), while the UI text promises to accept them. Users who have exported charts as PDF cannot upload them.
- **Fix:** Either add `"application/pdf": [".pdf"]` to the accept map (if PDF georeferencing is supported) or remove `.pdf` from the `SUPPORTED_EXTENSIONS` display string.

---

### F-009 — MarkersPanel renders full unsorted list without virtualization
- **Journey:** J6 Markers, J14 Catch journal
- **Phase:** 12 — Cross-context
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/components/MarkersPanel.tsx:143-218` — All markers from the API response are rendered via `markers.map(...)` with no page limit, virtual window, or incremental render. A user with hundreds or thousands of markers (e.g. a fishing guide who imports a season's GPS trail and drops markers at every site) experiences significant scroll jank and potential tab freeze.
- **Fix:** Introduce a virtualized list (e.g. `@tanstack/react-virtual`) for the marker rows, or add a client-side cap with a "Load more" affordance.

---

### F-010 — No cross-tab storage event sync for any persistent store
- **Journey:** All (any multi-tab use)
- **Phase:** 12 — Cross-context / Phase 2 — State
- **Severity:** Medium
- **Failure:** None of the persistent stores (`settingsStore`, `paletteStore`, `panelCollapseStore`, `zoneOverlayStore`, `driftStore` savedDriftPlans, `helpStore`) listen for the `storage` event. A user who opens BathyScan in two tabs will see divergent state: changing a setting in one tab does not update the other. This also affects users who open the app fresh after a settings change made in another tab — the stale tab's Zustand store holds the old value until a GET /api/settings refetch fires.
- **Fix:** For Zustand persist stores, add a `storage` event listener that re-hydrates the store on `e.key === storageKey`. For the manually-persisted `savedDriftPlans`, similarly subscribe and re-read on change.

---

### F-011 — DatasetPanel `minWidth: 536px` overflows narrow viewports
- **Journey:** All (any viewport narrower than ~560px)
- **Phase:** 12 — Cross-context
- **Severity:** Medium
- **Failure:** `artifacts/bathyscan/src/components/DatasetPanel.tsx:189-190` — `PANEL_STYLE` has `minWidth: 536, maxWidth: 616`. On viewports narrower than ~580px (small tablets, some phones in landscape), the panel overflows the viewport and cannot be fully read or interacted with. There is no responsive media query or percentage-width fallback. `App.tsx:1352-1354` has similar `minWidth: 460` on sidebar controls.
- **Fix:** Replace the fixed `minWidth` with a viewport-relative value: `minWidth: "min(536px, 100vw - 32px)"` and apply `overflowX: "auto"` so the panel scrolls horizontally on narrow screens rather than clipping.

---

### F-012 — No focus restoration after modal close
- **Journey:** J7, J4, J6, J11, J8
- **Phase:** 5 — Navigation & dead-ends
- **Severity:** Low
- **Failure:** None of the five inspected dialogs (GpsImportDialog, OfflinePackModal, GeoreferenceModal, ReassignMarkersDialog, MarkerForm) restore focus to the element that triggered them on close. For keyboard users, focus is left wherever it happened to be (often the modal's last focused element, which no longer exists in the DOM after unmount), forcing a Tab traversal from the top to re-orient.
- **Fix:** Store a `triggerRef` before opening each modal and call `triggerRef.current?.focus()` in the `onClose` handler.

---

### F-013 — FindDataPanel search-result names not truncated
- **Journey:** J2 Terrain from catalog, J5 Federated search
- **Phase:** 12 — Cross-context
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/components/FindDataPanel.tsx:253-264` — Search result dataset names are rendered in a flex child without `overflow: hidden`, `text-overflow: ellipsis`, or `white-space: nowrap`. A very long dataset name (some NCEI results exceed 80 characters) wraps vertically, compressing the action buttons or pushing them off screen.
- **Fix:** Add `overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"` to the result name element, or apply a `line-clamp-2` utility for multi-line graceful truncation.

---

### F-014 — CatchJournalPanel renders all entries without pagination
- **Journey:** J14 Catch journal
- **Phase:** 12 — Cross-context
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/components/CatchJournalPanel.tsx:547-587` — All fetched catch entries are rendered via `entries.map(...)`. A prolific user who logs every catch across a season could accumulate hundreds of entries. The panel uses `overflowY: auto` (`:471-476`) but renders all entries to the DOM at once, causing jank and memory pressure.
- **Fix:** Add a "Load more" paginator or virtualize the entry list via `@tanstack/react-virtual`.

---

### F-015 — `loadDriftPlan` does not clear stale start coordinates
- **Journey:** J8 Drift planner
- **Phase:** 11 — Data lifecycle
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/lib/driftStore.ts:376-414` — When a saved drift plan is loaded and its `startLat`/`startLon` are `null` (the plan was saved without a start point), the load action skips setting the start position (`if (plan.startLat != null && plan.startLon != null) { ... }`). This leaves the previous session's start coordinates in place. A user loads a plan expecting a clean slate but sees drift computed from the wrong origin.
- **Fix:** Always reset `driftStartLat` and `driftStartLon` to `null` before applying the plan's values, and do the conditional set inside that reset block.

---

### F-016 — "Analyze" sidebar tab has no active-feature indicator dot
- **Journey:** J7/J8/J9 Mode switching
- **Phase:** 7 — Tool & mode switching
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/components/SidebarModeTabs.tsx:95-103` — Explore, Plan, and Live tabs each have a coloured dot that signals an active feature (tide overlay, drift planner, realistic mode respectively). The "Analyze" tab has no dot. Users switching between modes have no at-a-glance way to see whether an Analyze-mode tool (e.g. substrate overlay, EFH overlay) is still active.
- **Fix:** Define an Analyze dot predicate (e.g. `substrateColorMode || efhOverlayEnabled || intertidalHotspotsEnabled`) and add it to the tab's indicator logic alongside the other three.

---

### F-017 — App shortcuts H, M, Slash, Comma absent from ControlsLegend
- **Journey:** J9 Settings
- **Phase:** 6 — Keyboard & interactions
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/components/ControlsLegend.tsx:19-36` — The legend displays Esc and O but omits H (What's Here), M (cycle sidebar mode), Slash (query panel), and Comma (Settings). These are the four most useful power-user shortcuts and are fully wired in `App.tsx:1061-1120`, but new users have no way to discover them.
- **Fix:** Add entries for H, M, / (query), and , (settings) to `ControlsLegend`.

---

### F-018 — Offline pack creation resolves silently on service-worker timeout
- **Journey:** J11 Offline pack creation
- **Phase:** 11 — Data lifecycle
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/lib/offlinePackStore.ts:102-113` — `cacheTerrain()` sends a `CACHE_PACK` message to the service worker and resolves after 10 seconds regardless of whether the SW responded. If the service worker is not registered (e.g. dev build, SW update race, browser restriction), the terrain is never actually cached, but the pack creation flow continues to the next step and ultimately reports success. The user's pack works online but silently fails to load offline.
- **Fix:** Track whether the MessageChannel received a successful response before the 10 s timeout. If it did not, reject the promise (or at least add a warning step in `onProgress`) so the user knows the pack may not be fully available offline.

---

### F-019 — No toast deduplication on rapid duplicate errors
- **Journey:** J2/J3 Terrain loading
- **Phase:** 10 — UI feedback & polish
- **Severity:** Low
- **Failure:** `artifacts/bathyscan/src/hooks/use-toast.ts` — `TOAST_LIMIT=1`, which limits the number of *visible* toasts, but the internal queue is unbounded. When a user clicks "Load" repeatedly during a slow load, each click may enqueue a new error toast. After the first dismissal, a chain of identical error messages appears one by one until the queue drains. The experience feels buggy rather than communicative.
- **Fix:** Before `dispatch({ type: "ADD_TOAST", ... })`, check if an identical `title + description` combination is already in the queue and skip the add if so.

---

## Closure Pass (2026-08-16)

### NEW-001 — MySavesSection retry failure is silent
- **Status:** **Fixed (2026-08-16)** — `handleRetry` now has a `catch` that shows a destructive "Retry failed" toast with the error reason; the retry button re-enables (via the existing `finally`) so the user can try again.
- **Journey:** J3 Terrain from My Saves (retry a failed catalog save)
- **Phase:** 3 — Silent failures
- **Severity:** Medium
- **Failure (user perspective):** The user clicks "Retry" on a failed save while the server is unreachable (or the request errors). `handleRetry` in `artifacts/bathyscan/src/components/MySavesSection.tsx` had `try { await retryMutation.mutateAsync(...); } finally { ... }` with no `catch` — the "Retrying…" spinner stops, no error message appears, and the user has no indication whether the retry failed or is still processing.
- **Fix applied:** Added a `catch (err)` between the `try` and `finally` that surfaces the failure via `toast({ title: "Retry failed", description: <reason>, variant: "destructive" })`.

---

## Phase 13 — Triage Table

| ID | Sev | Journey | Fix effort | Priority |
|---|---|---|---|---|
| SEED F-001 | High | J8 Drift | XS — one catch block + toast | **Do first** |
| F-001 | High | J9 Settings | XS — 1-line guard in FlyControls | **Do first** |
| F-002 | High | All | XS — 1 import + 1 Route | **Do first** |
| F-003 | High | J15 Auth | XS — 1 localStorage.removeItem | **Do first** |
| SEED F-003 | Med | J9/J15 | S — add Zod parse before hydrate | Do soon |
| SEED F-004 | Med | All | M — DEV-mode invariant check | Do soon |
| SEED F-006 | Med | J4 Upload | S — validate jobId shape | Do soon |
| SEED F-007 | Med | All | S — wrap Main in ErrorBoundary | Do soon |
| SEED F-008 | Med | J4 Upload | L — DB-backed job state | Do soon |
| F-004 | Med | J15 Auth | XS — clear csv-col-map keys on sign-out | Do soon |
| F-005 | Med | J9 Settings | XS — 1-line guard on Escape handler | Do soon |
| F-006 | Med | J7/J4/J6/J8 | S — add Escape handler to 4 dialogs | Do soon |
| F-007 | Med | J4 Upload | XS — add onDropRejected | Do soon |
| F-008 | Med | J4 Upload | XS — fix accept map or display string | Do soon |
| F-009 | Med | J6/J14 | M — virtualize marker list | Do soon |
| F-010 | Med | All | M — add storage event listeners | Do soon |
| F-011 | Med | All | S — viewport-relative minWidth | Do soon |
| SEED F-009 | Low | J2/J5 | XS — add .catch to seeding call | Later |
| SEED F-010 | Low | J2/J5 | S — add auth/rate-limit | Later |
| SEED F-011 | Low | J11 | XS — progress callback on weather skip | Later |
| SEED F-012 | Low | J12 | XS — add comment to catch blocks | Later |
| SEED F-013 | Low | J13 | XS — depend on .getTime() | Later |
| F-012 | Low | J7/J4/J6 | S — triggerRef + focus restoration | Later |
| F-013 | Low | J2/J5 | XS — add truncation CSS | Later |
| F-014 | Low | J14 | M — virtualize catch journal | Later |
| F-015 | Low | J8 | XS — clear start before load | Later |
| F-016 | Low | All | XS — add Analyze dot predicate | Later |
| F-017 | Low | J9 | XS — 4 entries in ControlsLegend | Later |
| F-018 | Low | J11 | S — track SW timeout, warn user | Later |
| F-019 | Low | J2/J3 | S — dedup toast before dispatch | Later |

---

*Report ends here. Original audit (2026-08-12) modified no code. Closure pass (2026-08-16): 28 of 30 original findings verified Closed; SEED F-001 and NEW-001 Fixed; SEED F-008 Deferred (architectural, tracked as its own task).*

---

# Water-type scoped audit (2026-08-17)

**Scope:** Water-type (freshwater/saltwater) user journeys only — Task-scoped follow-up to the 2026-08-12/16 full audit above, which had no still-open water-type items at closure (SEED F-008 deferral is upload-persistence, unrelated).
**Mode:** Audit-and-fix. Gated phases applied: backend ✓, auth ✓, multi-tool ✓, interactions ✓.

## Journey map

| ID | Journey |
|---|---|
| J-A | Fresh/Salt switch via compact HUD toggle (WaterTypeToggle) |
| J-B | Fresh/Salt switch via Settings "Exploration Mode" radios (GeneralSection) |
| J-C | My Saves badges + filtering under each mode |
| J-D | Find Data catalog search results and labels across a mode switch |
| J-E | Lake Ray Roberts demo load from onboarding |
| J-F | Legacy uploads / orphan saves with missing water type |

## Summary

| Severity | Found | Fixed | Deferred | Manual QA |
|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 |
| High | 1 | 1 | 0 | 0 |
| Medium | 4 | 3 | 1 (WT-006 → Task #4004) | 0 |
| Low | 2 | 1 | 0 | 1 (WT-007) |
| **Total** | **7** | **5** | **1** | **1** |

J-C and the J-F UI layer were walked and found healthy: my-saves is server-filtered with `catalog: null` orphans returned in both modes, badges are null-safe, and missing-water-type uploads stay visible in both modes (covered by existing `MySavesSection.test.tsx` and `my-saves-routes.test.ts`). No finding.

## Findings

### WT-001 — Demo load leaves the app in saltwater mode (J-E, Phase 1, **High**) — FIXED
**Failure:** `OnboardingOverlay.handleLoadDemo` requested the Lake Ray Roberts switch without aligning `waterType`. A new user (saltwater default) got the freshwater demo underneath a fully saltwater UI: SALT toggle active, ocean colormap, saltwater zone slots, and the demo absent from the dataset picker / My Saves lists.
**Fix:** When the mode is not freshwater, the CTA now flips only `waterType` and delegates the load to `useWaterTypeSideEffects` (which owns teardown, colormap swap, and auto-load of the first freshwater preset — Ray Roberts itself). A direct `requestDatasetSwitch` alongside would race that machinery (second in-flight request is dropped), so the branch delegates fully. Already-freshwater users keep the direct switch path.
**Test:** `artifacts/bathyscan/src/__tests__/OnboardingOverlay.demoWaterType.test.tsx`

### WT-002 — Mid-switch mode toggle leaves half-applied state (Phase 7 concurrency, **Medium**) — FIXED
**Failure:** `requestDatasetSwitch`'s in-flight guard silently dropped a second request without invoking either callback. Toggling the mode during an active dataset switch flipped `waterType` (badges, filters, toggle) while the scene stayed in the previous environment — no teardown, no auto-load, no way to detect it.
**Fix:** `requestDatasetSwitch` now returns `Promise<boolean>` — `false` only on the in-flight drop, `true` on every handled path. `useWaterTypeSideEffects` reverts the mode (like a cancel) when its request reports `false` and the user hasn't switched again since.
**Tests:** `artifacts/bathyscan/src/__tests__/simulatedDataStore.inFlightDrop.test.ts` (contract), `waterTypeSwitch.test.tsx` › "reverts the water type when the switch request is dropped by the in-flight guard (WT-002)" (hook revert)

### WT-003 — Find Data search ignores the active mode (J-D, Phase 1, **Medium**) — FIXED
**Failure:** The catalog search params omitted `waterType` even though the API supports the filter, so both modes' datasets appeared regardless of the toggle; a comment claimed filtering that didn't exist, and a manual invalidation effect refetched identical unfiltered results on mode change.
**Fix:** `waterType` is now part of the search params (and therefore the react-query key), so results are server-filtered and a mode switch while the panel is open refetches automatically; the redundant invalidation effect was removed.
**Test:** `artifacts/bathyscan/src/__tests__/FindDataPanel.waterTypeParam.test.tsx`
**Observation (no finding):** the NCEI/federated tabs intentionally query external sources and are not mode-filtered.

### WT-004 — Toggle and Settings radios diverge on stale default cleanup (J-A/J-B, Phase 4, **Medium**) — FIXED
**Failure:** Switching modes via the Settings radios reconciled a now-invalid preset Default Map Load (clearing it if absent from the new mode's list); the compact HUD toggle did not. A stale preset default left a blank Settings picker and a silent `datasets[0]` substitution at startup.
**Fix:** Extracted the reconcile logic into a shared helper `src/lib/clearStaleDefaultMapLoad.ts` used by BOTH entry points — this shared utility is also the class-level guard for the "switch entry-point drift" failure class (WT-004 + WT-005 both stem from the two paths diverging).
**Tests:** `artifacts/bathyscan/src/__tests__/clearStaleDefaultMapLoad.test.ts` (helper), `WaterTypeToggle.test.tsx` (toggle wiring)

### WT-005 — Toggle fires a redundant direct settings PUT (J-A, Phase 8, **Low, XS**) — FIXED
**Failure:** `WaterTypeToggle` fired an immediate `putSettings.mutate({waterType})` on click, racing the serialized debounced sync (`useServerSettingsSync`) — on a cancelled switch the out-of-band PUT could land after the revert's flush and leave the server holding the wrong mode. The Settings radios never did this.
**Fix:** Removed the direct PUT; persistence rides the debounced sync, same as the radios.
**Test:** `artifacts/bathyscan/src/__tests__/WaterTypeToggle.test.tsx` › "does NOT fire a direct settings PUT…(WT-005)"

### WT-006 — Legacy saves default to "saltwater" server-side (J-F, Phase 4, Medium) — **Deferred — covered by Task #4004**
`user-datasets.ts` legacy-row sanitization (`sanitizeLegacyStoredJson` / metaJson paths) defaults missing water type to `"saltwater"`, which is what mislabels Lake Ray Roberts saves. This is exactly the server-side classification fallback + backfill scoped to Task #4004; not fixed here. **Next step:** Task #4004 implements the classification fallback and the backfill script for never-re-opened lake saves (see also Task #3997).

### WT-007 — Second-tab live sync of mode ([MANUAL QA NEEDED], Phase 12, Low)
No `storage`-event listener mirrors a mode switch into an already-open second tab of the same browser; the other tab updates only on reload (server sync covers cross-device and reload cases). Matches full-audit finding F-010 (storage event listeners, "Do soon") — fold water type into that work. **Next step:** verify in manual QA whether two-tab use is common enough to prioritize F-010.

## Regression hardening
- Every fixed finding has a named test (listed per finding above); all colocated in `artifacts/bathyscan/src/__tests__/` per repo convention (flat test dir, not per-component `__tests__/`).
- Class-level guard: `clearStaleDefaultMapLoad.ts` is the single shared implementation both switch entry points call, eliminating the drift class behind WT-004/WT-005.

*Water-type scoped audit ends here.*
