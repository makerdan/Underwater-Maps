# BathyScan — Mobile UX E2E Audit (Report-Only)

**Task:** #4010 · **Date:** 2026-08-17 · **Mode:** report-only (no code changed)
**Scope:** App as it exists on `main` today, audited at mobile widths — **375px** (primary), **390px** (`useIsNarrow` boundary), **767px** (upper bound of `useIsMobile`).
**Priority directive:** the mobile viewport must not be occluded by menus, panels, or overlays — every viewport-covering layer walked; stuck-open, wrong-stacking, or unreachable-dismiss = finding.
**Method:** code inspection with file:line evidence (three parallel codebase sweeps: overlay/occlusion inventory, mobile layout/breakpoints, mobile flows/touch). Checks that genuinely require a live touch device are tagged `[MANUAL QA NEEDED]` with rationale. Findings that Task #4001's replacement mobile shell would plausibly supersede are tagged `[SUPERSEDED-BY-#4001?]`.

Breakpoint facts used throughout: `useIsMobile` = width < 768, `useIsNarrow` = width < 390 (`hooks/use-mobile.tsx:3-35`); the CSS mobile block is `@media (max-width: 768px)` (`index.css:353`). Note the 1px JS/CSS mismatch at exactly 768 (M-021).

---

## Severity Summary

| Severity | Count | IDs |
| --- | --- | --- |
| Critical | 0 | — |
| High | 5 | M-001, M-002, M-003, M-004, M-005 |
| Medium | 10 | M-006 … M-015 |
| Low | 9 | M-016 … M-024 |
| Seeds carried | 2 | SEED-F-008 (open/deferred), SEED-F-006/F-012 (re-verified fixed) |

Rubric applied per skill + task plan: **occlusion of the viewport with no reachable dismiss ≥ High**.

---

## Overlay & Occlusion Matrix (mobile width, 375px unless noted)

Every layer that can cover or partially cover the viewport. "Dismiss" lists all paths verified in code; **Esc is not a real dismiss path on touch devices** (no hardware keyboard) — a layer whose only non-button dismissal is Escape counts as button-only on mobile.

| Layer | Trigger | z | Coverage @375 | Dismiss paths | Touch-target adequacy | Stuck-open risk |
| --- | --- | --- | --- | --- | --- | --- |
| OnboardingOverlay backdrop+card | first visit (`hasSeenOnboarding` false) (`OnboardingOverlay.tsx:124-126,201`) | 9000/9001 | full viewport | backdrop tap = skip (`:225-236`); Esc skip; Skip/Done/CTA buttons (`:133-176`) | buttons OK; card 420px w/ `maxWidth calc(100vw-32px)` fits width (`:238-259`) | **card has no max-height/scroll — on short viewports buttons can sit below the fold (M-006)**; `suppressed` hides w/o unmount by design (`:114-121,203-206`) |
| Session-expired banner (rendered via `OfflineReadOnlyBanner` styling) | 3 consecutive post-Clerk-load 401s, or `getToken()` null ×2 (`queryClient.ts:474-484,379-389`) | 9999 | full-width top strip | **none — non-dismissable by design; page-lifetime latch, never resets (`queryClient.ts:390-396`)** | n/a | **latch is permanent even if auth later recovers → spurious-fire = stuck until reload (M-002)** |
| OfflineReadOnlyBanner | offline w/ saved data (`lib/offlineStore.ts:3-24`) | 9999 | full-width top strip | none (by design; clears on reconnect) | n/a | clears on `online` event — OK |
| DevApiDownBanner | DEV only (`App.tsx:2512`) | 9998 | top strip | close button (`DevApiDownBanner.tsx:108+`) | OK | none (DEV-only) |
| ContextMenu (global; also serves DatasetFolderTree menus via store, `DatasetFolderTree.tsx:1009,1058`) | right-click / terrain long-press (`lib/terrainContextMenu.ts:250-282`) | 9999 | small menu, viewport-clamped (`ContextMenu.tsx:151-162`) | outside `pointerdown` (works for touch), Esc (`:50-96,143-149`) | items OK | **no scroll/orientation handler; store not reset when triggering panel/view unmounts (`lib/contextMenuStore.ts:22-28`) → stale menu with actions bound to unmounted context (M-005)** |
| FindDataPanel | Find Data button / onboarding CTA (`App.tsx:318/347`) | 100 | **fixed right:0 width:380 > 375 viewport — full occlusion, left edge clipped off-screen (`FindDataPanel.tsx:106-121`); no mobile CSS override** | header ✕ only (`:1598-1614`); **no Escape handler**; no backdrop | ✕ is a bare 21px-glyph button, no padding — well under 44px | High: full occlusion with a single small close control (M-001) |
| QueryPanel | `/` key or QUERY button | 50 | mobile CSS → full-width bottom sheet (`index.css:387-392`) | ✕ (`QueryPanel.tsx:208`), Esc (`:285`) | OK | none found; sits under FindData z100 |
| EfhDetailPanel | tapping EFH feature | 60 | 320px card at right:16 ≈ 85% width (`EfhDetailPanel.tsx:47-70`) | ✕ (`:95-110`), capture-phase Esc (`:22-34`); no backdrop | ✕ OK | none — partial occlusion, dismissable (M-020) |
| MarkerForm | marker create/edit | (modal) | large panel | Esc (`MarkerForm.tsx:228-240`), Cancel/Save (`:469,781`); **no backdrop-dismiss — intentional (dirty-guard AlertDialog)** | OK | dirty-guard only; OK |
| MarkerDetailCard | tapping marker | 35 | partial card | Esc (`MarkerDetailCard.tsx:38-41`), close button, store hide | OK | none |
| OverviewMap (fullscreen mode) | Overview expand | 40 (children 41–100) | full viewport | close button + global Esc capture (`OverviewMap.tsx:6850-6860`) | OK | none; **but interactions are mouse-only — M-004** |
| WebglContextLostOverlay | WebGL context loss | 50 (absolute inset-0 of scene) | scene = full viewport | retry/restore button only (`WebglContextLostOverlay.tsx:28-54`) | OK | remains if context never restores — acceptable (it's the recovery UI); suppresses onboarding rather than stacking (`OnboardingOverlay.tsx:203-206`) |
| TourScene loading screens | tour scene boot | 50 / 30 (`TourScene.tsx:673,692,719-723`) | scene | auto-dismiss on load | n/a | transient; ties QueryPanel/WebGL at z50 (M-024) |
| HelpWindow | Help icon | 1000 | **mobile = fixed inset-0 full-screen (`HelpWindow.tsx:220-237`)** | titlebar close (after `:260`); no backdrop (moot — full-screen); mobile detector disables drag/keys (`:165-194`) | verify close size `[MANUAL QA NEEDED]` | none found (`if (!open) return null`) |
| DatasetPanel mobile bottom sheet | `showDatasetPanel` setting | 25 | `.dataset-panel` fixed bottom, max-height 60vh (`index.css:360-371`; class at `DatasetPanel.tsx:3039`) | collapse toggle ▸/▾ (`:3048-3061`) reduces to header strip; full removal only via setting | toggle OK (36px glyph in header) | no close, only collapse — acceptable; sits under home indicator (M-008) |
| DatasetPanel upload/progress overlay | active upload | 9999 fixed (`DatasetPanel.tsx:300-302`) | overlay | operation-bound | — | bound to upload lifecycle; see SEED-F-008 |
| GpsImportDialog | import GPS | 9000 | **width 520 > 375 (`GpsImportDialog.tsx:736`)** | Esc + backdrop + ✕, all suppressed during active import (`:218-228,728-730,775-776,2742,2846`) | close reachable if not clipped — see M-003 | intentional lock during import; overflow risk M-003 |
| GpsExportDialog | export GPS | 9000 | **width 460 > 375 (`GpsExportDialog.tsx:263`)** | backdrop + ✕ (`:4091-4140`); **no Esc handler found** | see M-003 | overflow risk M-003 |
| ReassignMarkersDialog | reassign markers | 9000 | **width 480 (`ReassignMarkersDialog.tsx:179`)** | Esc + backdrop + ✕, disabled during reassignment (`:48-58,172-173,218`) | see M-003 | intentional lock during op |
| OfflinePackModal | offline pack | 9999 | **width 460 (`OfflinePackModal.tsx:236`)** | Esc (`:136-144`), backdrop (`:224`), ✕ (`:265,644`); guarded during op | see M-003 | intentional |
| GeoreferenceModal | georeference | 9999 | large | Esc (`GeoreferenceModal.tsx:74-81`), backdrop (`:147`), ✕ (`:175,376`) | OK | none |
| BulkOfflinePanel | bulk offline | 9999 | **width 500 (`BulkOfflinePanel.tsx:521`)** | Esc/backdrop/✕, disabled while running/paused (`:5277-5292,5352-5362,5462`) | see M-003 | intentional |
| SimulatedDataConfirmDialog | simulated-data gate | 9500 | **width 480 (`SimulatedDataConfirmDialog.tsx:117`)** | Esc + cancel/confirm (`:644-679`) | see M-003 | none |
| ShallowDatasetBanner | shallow dataset | 60 fixed (`ShallowDatasetBanner.tsx:219-223`) | strip | own dismiss logic | OK | none found |
| Measurement / LandTerrainStatus banners | tool state | 25 absolute | strips | tool exit | OK | none |
| ToolbarRelocationHint | one-time hint | no fixed/viewport positioning found | not viewport-covering | — | — | none |
| Toast viewport | toasts | 100 | mobile = **top**-anchored full-width (`ui/toast.tsx:17`) | swipe/auto/close | OK | ties FindData at z100 (M-024) |
| VirtualJoystick overlay | touch device / forceVisible (`App.tsx:1907-1916`) | 30, pointer-events-none | full-screen transparent; two 100×100 circles bottom-left/right (`VirtualJoystick.tsx:177-236`) | n/a (control, not modal) | nubs 44×44 but pointer-events none — window-level listeners (`:187-198,116-129`) | overlaps QuickDrop/minimap bottom-right (M-011) |
| iOS install hint | iOS Safari | 60 absolute, bottom 80 | centered pill, `whiteSpace: nowrap` (`App.tsx:1807-1850`) | ✕ only (`:1834-1848`) | ✕ small — verify | nowrap text can exceed 375 width (M-022) |
| Resume hint | tab resume | 35, pointer-events-none (`App.tsx:1852-1882`) | informational | auto | n/a | none |
| shadcn Sheet sidebar (`ui/sidebar.tsx`) | — | — | **NOT MOUNTED** — no `SidebarProvider`/`<Sidebar` usage outside `ui/sidebar.tsx`; App uses a custom absolute sidebar div (`App.tsx:1404-1413`) | n/a | n/a | The task plan's "Sheet sidebar, close X hidden" concern is moot: dead code, not a user-facing layer |

**z-stack observed (ascending):** −1 (Tour bg) · 10/20 (shadcn sidebar, unused) · 25 (.dataset-panel, measurement/land banners) · 30 (joystick, tour status) · 34/35 (timeline/marker card, resume hint) · 40–55 (OverviewMap) · 50 (QueryPanel, WebGL overlay, Tour loaders, shadcn dialog/drawer) · 60 (EFH, Shallow, iOS hint) · 100 (FindData, toasts, Overview dropdown) · 1000/1100 (HelpWindow, DatasetPanel main) · 9000/9001 (GPS dialogs / onboarding) · 9500 (SimulatedDataConfirm) · 9998 (DevApiDown) · **9999 six-way tie** (session banner, offline banner, ContextMenu, OfflinePackModal, GeoreferenceModal, BulkOfflinePanel, DatasetPanel upload overlay) — see M-024.

---

## Journeys Walked (mobile lens)

1. First load on phone → onboarding overlay → skip/complete (Phases 1, 12b)
2. Browse & pick a dataset (DatasetPanel bottom sheet, DatasetFolderTree, Find Data) (Phases 1, 6)
3. View & navigate terrain (touch fly controls, joystick, long-press crosshair menu) (Phases 1, 9)
4. Open each sidebar mode (SidebarModeTabs ×4, panels, Live, Plan, Analyze) (Phases 6, 9)
5. Open every dialog/modal (GPS import/export, reassign, offline pack, georeference, bulk offline, marker form) (Phases 3, 5)
6. Live mode + timeline scrub + drift timeline (Phase 9)
7. Settings page (Phase 7)
8. Auth/session expiry + offline (Phase 8)
9. Overview Map full-screen (Phases 1, 9)
10. Help / documentation discovery (Phase 6)

**Phase coverage:** Phases 0–12 all applied with mobile lens; gates set backend=true, auth=true, multi-tool=true, touch-interactions=true. Phase 12b (responsive @375) treated as core per plan. Phase 13 (fix loop) intentionally **not run** — report-only. Skipped: third-party widget internals (per skill), not-yet-merged #4001/#4002/#4003 surfaces (not in this workspace).

---

## Findings

### High

**M-001 — Find Data panel fully occludes a 375px viewport with one tiny close control and no Escape/backdrop**
*Journey 2 · Phase 12b/6 · High · `[SUPERSEDED-BY-#4001?]`*
`FindDataPanel` is `position:fixed; top:40; right:0; bottom:0; width:380; zIndex:100` (`FindDataPanel.tsx:106-121`) with **no mobile override** (the `index.css:387-392` mobile block covers QueryPanel only). At 375px it covers 100% of the viewport width (left ~5px clipped off-screen) and everything under z100. The only dismissal is the header ✕ — a borderless button whose hit area is just the 21px glyph (`:1598-1614`), far below the 44px minimum; there is **no Escape handler and no backdrop**. A mis-tap leaves the user visually trapped in the panel.
**Fix:** add a mobile rule making FindDataPanel full-width with `width:100%` (or a proper bottom sheet), give the ✕ ≥44px padding, and add an Escape handler for parity with QueryPanel.

**M-002 — Session-expired banner can latch spuriously and is unrecoverable without reload**
*Journey 8 · Phase 8 · High*
The banner (top strip, z9999, non-dismissable **by design**) fires on 3 consecutive post-Clerk-load 401s (`queryClient.ts:474-484`) or when `getToken()` returns null twice (`:379-389` + App token-wirer). The 401 counter *is* reset by any successful query (`:520-535`), which narrows but does not close the race: a burst of three 401s during a token-refresh blip (or two null `getToken()` results while backgrounded/waking) trips the signal, and `signalSessionExpired()` is an explicit **page-lifetime latch — "the signal is not reset"** (`:384-396`). Once tripped, the banner persists forever even if auth fully recovers on the next request, and offers no re-auth or dismiss affordance — only a manual reload. On mobile (frequent tab freezing/waking, flaky radio) the spurious-trip probability is materially higher than desktop.
**Fix:** clear the latch when a subsequent authenticated request succeeds (or when Clerk reports a fresh session), and/or give the banner a "Re-authenticate" action instead of relying on reload.

**M-003 — Seven fixed-width modals (400–520px) overflow a 375px viewport; several lock out backdrop+Escape during operations**
*Journey 5 · Phase 12b/5 · High*
Fixed widths with no responsive wrapper: GpsImportDialog **520** (`GpsImportDialog.tsx:736`), BulkOfflinePanel **500** (`BulkOfflinePanel.tsx:521`), SimulatedDataConfirmDialog **480** (`SimulatedDataConfirmDialog.tsx:117`), ReassignMarkersDialog **480** (`ReassignMarkersDialog.tsx:179`), GpsExportDialog **460** (`GpsExportDialog.tsx:263`), OfflinePackModal **460** (`OfflinePackModal.tsx:236`), plus HabitatPanel minWidth **400** (`HabitatPanel.tsx:60`) and TerrainDownloadPopover **400** (`TerrainDownloadPopover.tsx:199`). At 375px content and potentially the top-right ✕ are clipped off-screen. Backdrop strips above/below usually remain tappable, **but** ReassignMarkers/BulkOffline/GpsImport intentionally disable Esc+backdrop+✕ while an operation runs — combined with clipping, a phone user can face a full-viewport occlusion with no visible dismiss until the operation ends. GpsExportDialog additionally has **no Escape handler at all**. (OnboardingOverlay's 420px is exempt — it has `maxWidth: calc(100vw - 32px)`.)
**Fix:** apply the onboarding pattern (`maxWidth: calc(100vw - 32px)` + internal scroll) to all fixed-width dialogs; keep operation locks but ensure the progress/cancel affordance is on-screen at 375px.

**M-004 — Settings page is structurally broken at 375px**
*Journey 7 · Phase 7/12b · High*
Settings keeps a fixed 180px nav sidebar + 28px content padding in a two-column flex with **no mobile media rule** (`pages/settings/styles.ts:36-48`, `Settings.tsx:317-348`), leaving ~139px for content at 375px; the topbar's BACK / SETTINGS / SHOW ADVANCED / status / version row collides (`Settings.tsx:184-314`). The settings Toggle is a 36×20 non-button clickable (`styles.ts:154-169`, `Settings.tsx:242-244`) — under half the 44px touch minimum and invisible to the global mobile button-inflation CSS (which targets `button` elements only, `index.css:353-358`).
**Fix:** stack nav above content below 768px; render Toggle as a `button`/`role=switch` sized by the existing coarse-pointer rule (`index.css:159-169`).

**M-005 — Overview Map interactions are mouse-only; touch drag/box-select/marker-drag do not work**
*Journey 9 · Phase 9 · High · `[MANUAL QA NEEDED]` (degree of degradation — plain taps may still work via `click`)*
The fullscreen Overview Map registers `mousedown/mousemove/mouseup/mouseleave/wheel/click/contextmenu` and only `pointercancel` — **no pointerdown/move/up or touch listeners** (`OverviewMap.tsx:3181-3188`). On touch devices, drag-panning, box selection, and marker/handle dragging have no input path. This is the primary 2D navigation surface on a phone (the 3D scene, by contrast, has full touch support in FlyControls — `FlyControls.tsx:525-631`, `useFlyControls.ts:120-156`).
**Fix:** migrate handlers to pointer events (they cover mouse + touch) and add pinch-zoom as the wheel equivalent. Live-device QA needed to confirm which sub-interactions survive via synthesized `click`.

### Medium

**M-006 — Onboarding card can overflow short mobile viewports; no internal scroll**
*Journey 1 · Phase 1/12b · Medium · `[SUPERSEDED-BY-#4001?]`*
Card fits 375px width via `maxWidth: calc(100vw-32px)` but has **no max-height/scroll container**; 16.5px monospace copy at line-height 1.65 over 5 steps can push Skip/Next below the fold on short/landscape viewports (`OnboardingOverlay.tsx:238-262`). Backdrop-tap-to-skip (`:225-236`) prevents a true trap, but users won't discover it.
**Fix:** `maxHeight: calc(100dvh - 32px); overflow-y: auto` on the card.

**M-007 — Onboarding teaches desktop-only controls to mobile users**
*Journey 1 · Phase 6 · Medium · `[SUPERSEDED-BY-#4001?]`*
Steps reference W/A/S/D, scroll-wheel, Q/E, right-click drag, and the `/` key (`OnboardingOverlay.tsx:46-70`) — none exist on touch. Combined with M-008 there is no mobile gesture documentation anywhere.
**Fix:** branch step copy on `useIsMobile` (drag = look, pinch = zoom, two-finger = orbit, long-press = crosshair menu — all already implemented in FlyControls).

**M-008 — ControlsLegend hidden on mobile with no replacement; H / , / Esc and gestures undocumented**
*Journey 10 · Phase 6 · Medium*
`index.css:394-397` hides ControlsLegend below 768px; it is the only in-app documentation for pinch/two-finger orbit, crosshair menu, `H` What's Here, `,` Settings, Esc (`ControlsLegend.tsx:28-40`). The Overview verbose hint is also hidden (`index.css:399-402`). Mobile users get zero affordance documentation (see also M-007).
**Fix:** a compact mobile gesture-help entry (e.g. inside HelpWindow, which *is* mobile-friendly).

**M-009 — No safe-area handling: bottom sheets and timeline sit under the iPhone home indicator; top banners under the notch**
*Journey 2/6 · Phase 12b · Medium · `[MANUAL QA NEEDED]` (device-specific inset behavior)*
No `env(safe-area-inset-*)` anywhere; `index.html:5` viewport lacks `viewport-fit=cover`. `.dataset-panel` (bottom:0, 60vh, `index.css:360-371`), QueryPanel bottom sheet (`index.css:387-392`), TimelineScrubBar (fixed bottom:0, `TimelineScrubBar.tsx:155-175`) all collide with the home-indicator gesture zone; z9999 top banners have no safe-area top padding (`OfflineReadOnlyBanner.tsx:59-63`).
**Fix:** add `viewport-fit=cover` + `padding-bottom: env(safe-area-inset-bottom)` on bottom-anchored fixed elements, `padding-top: env(safe-area-inset-top)` on top banners.

**M-010 — TimelineScrubBar unusable at 375px: non-shrinking children leave ~zero scrub range; play button 32×28**
*Journey 6 · Phase 9/12b · Medium*
Fixed children — play 32px (`TimelineScrubBar.tsx:177-192`), two 60px labels, time label min-width 148 (`:201-209`), 16px paddings — consume nearly the whole 375px row, leaving negligible/negative width for the range input (visual height 4px, `:194-199`). Play button and 7×7 tide-marker `role=button` spans (`:254-287`) are far below 44px.
**Fix:** stack time label on its own row below 390px; enlarge play/tide-marker hit areas.

**M-011 — Virtual joysticks overlap QuickDrop / minimap controls at 375px**
*Journey 3 · Phase 9 · Medium · `[MANUAL QA NEEDED]` (real-device hit-testing)*
Right joystick occupies x≈255–355, y≈bottom-80–180 (`VirtualJoystick.tsx:177-236`); QuickDrop and minimap are bottom-right (`App.tsx:1741-1745,1894-1898`). The overlay is pointer-events-none but **window-level touch handlers still preventDefault on moves** (`VirtualJoystick.tsx:116-146`), so drags starting over those controls are captured by the joystick's half-screen split (`:116-129`).
**Fix:** reserve joystick zones (offset controls up) or hit-test controls before claiming the touch.

**M-012 — Sub-44px touch targets on non-button clickables that the global mobile CSS cannot inflate**
*All journeys · Phase 12b · Medium*
The mobile block inflates `button` elements to ≥44px (`index.css:353-358`) and coarse-pointer buttons/switch/range to 52px (`:159-169`), but misses non-button clickables: Settings toggle 36×20 (M-004), tide markers 7×7 (M-010), DriftTimeline close padding 2px 6px + 28px chips (`DriftTimeline.tsx:38-52,150-177`), SidebarSection clickable header divs (`SidebarSection.tsx:105`), CurrentsPanel toggle clickables (`CurrentsPanel.tsx:386-393`), ProximityHudChip (`ProximityHudChip.tsx:161`), FindData ✕ (M-001).
**Fix:** convert to `button` elements (also an a11y win) or extend the CSS rule to `[role=button], [role=switch]`.

**M-013 — Icon-only mobile controls rely on hover tooltips that don't fire on touch**
*Journey 4 · Phase 6/9 · Medium*
On mobile/narrow, HUD and tab controls collapse to icon-only (`HUD.tsx:134,278,376,428-510,535,587`; `SidebarModeTabs.tsx:88-165`) with labels supplied by `ViewscreenTooltip` → Radix Tooltip, which is hover/focus-oriented with no touch handling (`ViewscreenTooltip.tsx:55-72`). Touch users get unlabeled icon buttons.
**Fix:** `aria-label`s exist via tooltip wiring in some spots — audit each icon-only control for an accessible visible label or long-press hint on mobile.

**M-014 — Canvas lacks `touch-action` CSS; browser gesture arbitration can fight custom pinch/orbit**
*Journey 3 · Phase 9 · Medium · `[MANUAL QA NEEDED]` (double-tap-zoom behavior varies by browser)*
No global `touch-action` rule; single inline `touchAction:'pan-y'` at `App.tsx:1412` (sidebar). Pinch/two-finger orbit is implemented in JS (`FlyControls.tsx:525-631`) but the canvas has no `touch-action: none`, leaving double-tap zoom / native pinch racing the app's handlers. `maximum-scale=1` in the viewport meta (`index.html:5`) suppresses some of this on iOS but is itself an accessibility anti-pattern (blocks intentional zoom).
**Fix:** `touch-action: none` on the 3D canvas; reconsider `maximum-scale=1` (WCAG 1.4.4).

**M-015 — No iOS input auto-zoom guard: inputs under 16px trigger focus zoom**
*Journey 5/7 · Phase 12b · Medium*
No global mobile `input/select/textarea { font-size: 16px }` rule; while many inputs are 16.5px (`FlyControls.tsx:1803-1822`, `OfflinePackModal.tsx:305,399`), several inherit 12–15px styles. On iOS Safari, focusing a <16px input zooms the page — jarring mid-flow (partially masked today by `maximum-scale=1`, which M-014 recommends removing, so fix these together).
**Fix:** global mobile rule forcing ≥16px on form controls.

### Low

**M-016 — Sidebar height uses `100vh`, not `100dvh`: URL-bar show/hide clips or overruns the panel**
*Journey 4 · Phase 12b · Low* — `App.tsx:1408` `maxHeight: calc(100vh - 7rem)`; mobile URL bar changes real viewport height. Settings already uses `100dvh` correctly (`pages/settings/styles.ts:5,47`). **Fix:** switch to `100dvh` with `100vh` fallback.

**M-017 — Sidebar content can overflow 375px viewport by a few px; no horizontal clip**
*Journey 4 · Phase 12b · Low* — panel shells request `min(460px, 100vw-32px)` / DatasetPanel `min(536px, 100vw-32px)` (`SidebarModeTabs.tsx:111-124`, `DatasetPanel.tsx:205`, `App.tsx:1446,1517,1688`) = 343px at left:16 — exact fit; the sidebar container's `paddingRight:4` + borders push a few px past the edge, and it clips only vertically (`App.tsx:1404-1413`). The Hide button stays reachable (anchored to measured right edge, `App.tsx:1378-1383`). **Fix:** account for container padding in the `min()` expressions or add `overflow-x: clip`.

**M-018 — DriftTimeline content can overflow its 295px max width; close button tiny**
*Journey 6 · Phase 12b · Low* — maxWidth `calc(100vw - 80px)` (`DriftTimeline.tsx:19-36`) with unbreakable mode/leg badges (`:121-129`); close padding 2px 6px (counted in M-012). **Fix:** allow wrap + enlarge close.

**M-019 — iOS install hint uses `whiteSpace: nowrap`; text can exceed 375px**
*Journey 1 · Phase 12b · Low* — centered pill, bottom 80, z60, ✕-only dismissal (`App.tsx:1807-1850`). **Fix:** allow wrap + maxWidth.

**M-020 — EFH detail panel keeps desktop geometry on mobile (320px at right:16 ≈ 85% occlusion)**
*Journey 3 · Phase 12b · Low* — dismissable (✕ + Esc), so Low (`EfhDetailPanel.tsx:47-70`). **Fix:** full-width bottom-sheet treatment below 768px.

**M-021 — CSS/JS breakpoint off-by-one at exactly 768px**
*All · Phase 12b · Low* — CSS applies mobile styling at ≤768 (`index.css:353`) while `useIsMobile` is <768 (`hooks/use-mobile.tsx`); at width 768 the app renders desktop JS behavior with mobile CSS. **Fix:** align to `max-width: 767.98px`.

**M-022 — HelpWindow mobile close-affordance size unverified**
*Journey 10 · Phase 6 · Low · `[MANUAL QA NEEDED]`* — mobile HelpWindow is full-screen z1000 with titlebar close (`HelpWindow.tsx:220-261`); drag/keyboard correctly disabled on mobile (`:165-194`). Close-button hit size and scroll behavior need a live device pass.

**M-023 — WebglContextLostOverlay has no automatic timeout path**
*Journey 3 · Phase 5 · Low* — absolute inset-0 z50 with restore/retry button (`WebglContextLostOverlay.tsx:28-54`); if the restore event never arrives it persists — acceptable (it *is* the recovery UI) but on mobile (frequent GPU context loss when backgrounding) consider auto-retry on `visibilitychange`.

**M-024 — z-index ties make stacking DOM-order-dependent**
*All · Phase 12b · Low* — six layers tie at 9999 (ContextMenu, session/offline banners, OfflinePackModal, GeoreferenceModal, BulkOfflinePanel, DatasetPanel upload overlay); z9000 ties GPS dialogs; z100 ties FindData/toasts/Overview dropdown; z50 ties QueryPanel/WebGL/Tour loaders. Today's DOM order happens to work (e.g. ContextMenu mounts late, `App.tsx:2146`) but any reorder silently changes which layer wins — e.g. a context menu opening under a modal. **Fix:** centralize a z-scale constant module with distinct values.

---

## Seeds (from `ux-audit-report.md` / `bug-audit-report.md`), re-verified at mobile widths

**SEED-F-008 — Upload job state held in memory (Deferred in prior report) — still open**
Re-verified mobile-relevant: the DatasetPanel upload overlay (fixed z9999, `DatasetPanel.tsx:300-302`) reflects in-memory upload state; a mobile browser freezing/killing the tab mid-upload (far likelier than desktop) loses the job with no resume. Status unchanged — remains Deferred; noting the mobile risk amplifier only.

**SEED-F-006 / F-012 — Dialog dismissal gaps (Closed in prior report) — re-verified FIXED at mobile widths**
GpsImportDialog, GeoreferenceModal, ReassignMarkersDialog, OfflinePackModal all now have Escape/backdrop/close (evidence in the Occlusion Matrix); MarkerForm's no-backdrop design is intentional (dirty guard). The *new* mobile-specific residue (fixed widths > 375, operation-time lockouts) is reported as M-003, not a seed regression.

All other prior findings were verified Closed in `ux-audit-report.md`/`bug-audit-report.md` and no mobile-width regression of them was found during this pass.

---

## `[MANUAL QA NEEDED]` register

| Finding | What needs a live device | Why code inspection is insufficient |
| --- | --- | --- |
| M-004 | Overview Map: do taps still select via synthesized `click`? Does any drag work? | Browser click-synthesis from touch varies; only listener wiring is provable statically |
| M-005 (matrix row) | ContextMenu long-press open + outside-tap close on real touch | `pointerdown` should cover touch, but iOS long-press callout interference is device-specific |
| M-009 | Home-indicator / notch collisions on actual iPhone | Inset values are device-dependent |
| M-011 | Joystick vs QuickDrop/minimap touch conflicts | preventDefault interplay needs real gesture testing |
| M-014 | Double-tap-zoom vs custom pinch on canvas | Gesture arbitration differs per browser/OS version |
| M-022 | HelpWindow close-button hit size / scrolling | Rendered size depends on font scaling |

## `[SUPERSEDED-BY-#4001?]` register (report anyway; triage may defer)

M-001 (Find Data panel — if the mobile Chart View shell replaces the panel chrome), M-006, M-007 (onboarding overlay — if #4001 ships mobile-specific onboarding). Everything else (session handling, dialogs, Settings, Overview Map, touch targets, safe areas) lives in shared code paths #4001 does not replace.

---

*Report-only audit: no application code, styles, or config were changed. Next step is user triage — pick which findings to fix.*
