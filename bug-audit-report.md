# Bug & Error Audit Report

**Scope:** Whole app — `artifacts/bathyscan` (React/Vite/R3F frontend), `artifacts/api-server` (Express 5 API), shared `lib/` packages
**Mode:** report-only (no code was changed)
**Date:** 2026-07-18
**Stack:** TypeScript 5.9, React 19 + Vite + React Three Fiber, Express 5, Drizzle/PostgreSQL, Zod, Clerk auth. All ten audit categories applied (typed-language and React gates both active).

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 7 |
| Low | 6 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| 1 | High | Error handling | `artifacts/bathyscan/src/components/WeatherPanel.tsx:369` | Folder rename failure is swallowed — the name silently reverts with no message |
| 2 | Medium | Performance | `artifacts/bathyscan/src/hooks/useWaterTempTexture.ts:74` | Water-temperature GPU texture is rebuilt but the old one is never disposed |
| 3 | Medium | Type safety | `artifacts/bathyscan/src/hooks/useServerSettingsSync.ts:393,414` | Server settings are cast, not validated, before hydrating client stores |
| 4 | Medium | State & data integrity | `artifacts/bathyscan/src/lib/uiStore.ts:489` | uiStore ↔ settingsStore manual mirroring is a dual source of truth |
| 5 | Medium | Async & timing | `artifacts/bathyscan/src/hooks/useUpscaledHeatmap.ts:289` | AI upscale request is not aborted on unmount — wastes Poe credits |
| 6 | Medium | Null / undefined safety | `artifacts/bathyscan/src/components/DatasetPanel.tsx:1614` | `jobId` destructured from finalize response without validation |
| 7 | Medium | Error handling | `artifacts/bathyscan/src/App.tsx` | No error boundary around the sidebar or the 3D scene as a whole |
| 8 | Medium | Concurrency & shared state | `artifacts/api-server/src/lib/bucketMonitor.ts:131-146,428` | Upload job state and concurrency queue are in-memory only |
| 9 | Low | Async & timing | `artifacts/api-server/src/routes/catalog-saves.ts:62,102` | Startup seeding/recovery are fire-and-forget at module load |
| 10 | Low | Security | `artifacts/api-server/src/routes/catalog-saves.ts:131,150,197` | Catalog list/search/bbox endpoints have no auth and no rate limit |
| 11 | Low | Error handling | `artifacts/bathyscan/src/lib/offlinePackStore.ts:173` | Offline pack silently omits weather data on fetch failure |
| 12 | Low | Error handling | `artifacts/bathyscan/src/hooks/useWakeLock.ts:42,65` | Empty catch blocks on wake-lock release, no comment |
| 13 | Low | State & data integrity | `artifacts/bathyscan/src/components/CurrentsPanel.tsx:167-172` | Effect keyed on a `Date` object reference triggers redundant settings writes |
| 14 | Low | Dependency hygiene | `pnpm-lock.yaml` | 1 known low advisory (js-yaml 4.1.1, build-only) + duplicate zustand v4/v5 majors |

## Findings

### Finding 1 — Folder rename failure is silently swallowed
- **File and line:** `artifacts/bathyscan/src/components/WeatherPanel.tsx:369`
- **Category:** Error handling
- **Severity:** High
- **Risk:** `handleCommitFolderRename` catches the PATCH failure with a bare `catch { /* no-op; query will refetch */ }` and then closes the edit UI in `finally`. If the rename request fails (offline, 401 after session expiry, server error), the edit box closes as if it succeeded, and the old name quietly reappears on the next refetch. The user believes the rename worked.
- **Recommended fix:** In the catch block, surface the failure — a toast ("Couldn't rename folder — try again") — and keep or restore the edit state so the user's typed name isn't lost.

### Finding 2 — Water-temperature GPU texture never disposed on rebuild
- **File and line:** `artifacts/bathyscan/src/hooks/useWaterTempTexture.ts:74` (consumer: `components/WaterTempVolumeLayer.tsx:113-118`)
- **Category:** Performance (resource disposal)
- **Severity:** Medium
- **Risk:** The hook's own doc comment says "the old one is not automatically disposed by this hook. Use the returned texture inside a component that manages its own cleanup" — but the consuming `WaterTempVolumeLayer` only disposes its geometry and material, never the `DataTexture`. Every temperature-profile change (timeline scrubbing, area change) allocates a new GPU texture and orphans the previous one for the life of the tab. Textures are small (1×N RGBA), so this is slow-burn growth in long sessions rather than a quick crash.
- **Recommended fix:** In the consumer (or a small wrapper hook), track the previous texture and call `.dispose()` when it is replaced and on unmount — same pattern `LandmassMesh.tsx:140-147` already uses for geometry.

### Finding 3 — Server settings hydrated via cast instead of validation
- **File and line:** `artifacts/bathyscan/src/hooks/useServerSettingsSync.ts:393` and `:414`
- **Category:** Type safety
- **Severity:** Medium
- **Risk:** `serverSettings as Record<string, unknown>` and `serverSettings as Parameters<typeof hydrateFromServer>[0]` bypass type checking at the app's most central data boundary. Today the server validates GET /api/settings responses against the Zod schema before sending (it 500s on mismatch — seen working in the validation test run), so the practical risk is low, but any future path that skips server-side validation (cached responses, offline packs, schema version skew during deploys) would propagate malformed values straight into every store.
- **Recommended fix:** Parse the payload with the generated schema from `@workspace/api-zod` (safeParse; on failure, log and skip hydration) before calling `hydrateFromServer`.

### Finding 4 — uiStore ↔ settingsStore manual mirroring (dual source of truth)
- **File and line:** `artifacts/bathyscan/src/lib/uiStore.ts:489` (pattern repeats across setters)
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** Persisted settings live in `settingsStore`, but several UI values are mirrored by hand: each `uiStore` setter must remember to also call `useSettingsStore.setState(...)`. A new setter that forgets the mirror silently stops persisting that setting — the user's choice reverts on next load with no error anywhere. The sentinel tests (`check:mock-drift`, settings coverage sentinel) catch some drift but not a forgotten mirror in a brand-new setter.
- **Recommended fix:** Consolidate mirrored keys into one store, or add a small helper/middleware that updates both stores from a single declaration so the mirror can't be forgotten.

### Finding 5 — AI upscale request not aborted on unmount — FIXED
- **File and line:** `artifacts/bathyscan/src/hooks/useUpscaledHeatmap.ts:289`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** The hook guards setState with `isMountedRef`, so nothing crashes — but the `authorizedFetch` to `/api/poe/upscale` keeps running after the user navigates away. Upscale calls cost Poe credits and server time; rapid toggling of the heatmap can stack several concurrent paid requests whose results are all thrown away.
- **Recommended fix:** Create an `AbortController` per request, pass its signal to `authorizedFetch`, and abort in the effect cleanup / when `cacheKey` changes.
- **Resolution:** Fixed. Each Poe upscale request now creates an `AbortController` whose signal is passed to `authorizedFetch`; the request is aborted on unmount (effect cleanup), on `invalidate()`, and when a new request supersedes it. AbortError is swallowed silently. Covered by tests in `useUpscaledHeatmap.afterUnmount.test.ts`.

### Finding 6 — `jobId` destructured from finalize response without validation
- **File and line:** `artifacts/bathyscan/src/components/DatasetPanel.tsx:1614`
- **Category:** Null / undefined safety
- **Severity:** Medium
- **Risk:** `const { jobId } = await finalResp.json() as { jobId: string }` — a 200 response with an unexpected body (proxy interference, empty body, contract drift) sets `chunkedJobId` to `undefined` after the upload session has already been cleared (line 1616), leaving the UI polling a nonexistent job in "processing" forever with no path back.
- **Recommended fix:** Check `typeof jobId === "string" && jobId` before clearing the session; otherwise treat as a finalize error (existing error path at 1608-1611).

### Finding 7 — No error boundary around the sidebar or the 3D scene as a whole
- **File and line:** `artifacts/bathyscan/src/App.tsx`
- **Category:** Error handling
- **Severity:** Medium
- **Risk:** Individual panels (HUD, Tide, Weather, Trip) have boundaries, but a render error in the sidebar shell (tab logic, panel switching) or in an unguarded R3F component white-screens the entire app instead of degrading one region.
- **Recommended fix:** Wrap the sidebar container and the Canvas subtree in the existing `ErrorBoundary` component (using the `componentDidCatch` retry pattern already established in this codebase).

### Finding 8 — Upload job state and concurrency queue are in-memory only
- **File and line:** `artifacts/api-server/src/lib/bucketMonitor.ts:131-146` (slot queue), `:428` (fire-and-forget processObject), `activeJobs` map
- **Category:** Concurrency & shared state
- **Severity:** Medium
- **Risk:** Job status lives in a module-level `Map`; the concurrency cap uses an unbounded in-memory wait queue. A server restart mid-burst loses all queued work state — `recoverGcsJobStatus` and the client-side 15-minute watchdog paper over it, but users see uploads stuck in "processing" until the next scan re-discovers the objects, and a very large backlog grows the wait queue without bound.
- **Recommended fix:** Persist job status in Postgres (a small `upload_jobs` table) keyed by objectKey, and cap or drain the wait queue explicitly. (Related UX work is already tracked in the "waiting in line" task — this finding is the underlying durability gap.)

### Finding 9 — Startup seeding/recovery are fire-and-forget at module load
- **File and line:** `artifacts/api-server/src/routes/catalog-saves.ts:62` (`void seedDatasetCatalog()`), `:102` (`void recoverStuckSaves()`)
- **Category:** Async & timing
- **Severity:** Low
- **Risk:** If either fails at boot (transient DB outage), the server runs with an unseeded catalog or unrecovered saves; failures are logged and seeding is idempotent, but nothing retries.
- **Recommended fix:** Move both into an explicit startup routine with a retry, or schedule a delayed re-attempt on failure.

### Finding 10 — Catalog endpoints have no auth and no rate limit
- **File and line:** `artifacts/api-server/src/routes/catalog-saves.ts:131,150,197,285`
- **Category:** Security
- **Severity:** Low
- **Risk:** `GET /datasets/catalog`, `/catalog/search`, and the bbox/point-radius POST queries are unauthenticated and unlimited. The data is public catalog metadata (no confidentiality issue) and inputs are Zod-validated, but the search/bbox queries hit the database and could be hammered for cheap DoS.
- **Recommended fix:** Apply the existing `createRateLimit` middleware to these routes (auth optional — public catalog may be intentional).

### Finding 11 — Offline pack silently omits weather data on fetch failure
- **File and line:** `artifacts/bathyscan/src/lib/offlinePackStore.ts:173`
- **Category:** Error handling
- **Severity:** Low
- **Risk:** Best-effort weather fetch failure is swallowed; the pack reports success but is missing weather. The user discovers this offline on the water, when it's too late to redo.
- **Recommended fix:** Report "weather data skipped" through the existing `onProgress` channel / completion summary.

### Finding 12 — Empty catch blocks on wake-lock release
- **File and line:** `artifacts/bathyscan/src/hooks/useWakeLock.ts:42,65`
- **Category:** Error handling
- **Severity:** Low
- **Risk:** Ignoring release failures is probably fine, but the bare `catch {}` without a comment can mask a held wake lock (battery drain) and trips future audits.
- **Recommended fix:** Add an explanatory comment (or a debug-level log) so the intent is explicit.

### Finding 13 — Effect keyed on a `Date` object reference
- **File and line:** `artifacts/bathyscan/src/components/CurrentsPanel.tsx:167-172`
- **Category:** State & data integrity
- **Severity:** Low
- **Risk:** The dependency array uses `timelineCurrentTime` (a `Date`), compared by reference. Any new `Date` instance for the same instant re-runs the effect and writes `currentsTidePhase` into the settings store, feeding the debounced PUT /api/settings pipeline with redundant work while scrubbing.
- **Recommended fix:** Depend on `timelineCurrentTime.getTime()` and/or skip the store write when the computed phase is unchanged.

### Finding 14 — Dependency hygiene notes
- **File and line:** `pnpm-lock.yaml`
- **Category:** Dependency hygiene
- **Severity:** Low
- **Risk:** (a) 1 low-severity advisory: js-yaml 4.1.1 — build-time only, already documented as an accepted exception in `security-audit-exceptions.md`; do not "fix" via override (js-yaml ≥4.2 resolves to v5 and breaks Orval codegen). (b) Two major versions of zustand coexist (v4 via `tunnel-rat`/drei, v5 in the app) — already mitigated by `resolve.dedupe: ["zustand"]` in `vite.config.ts`; keep that line when touching Vite config.
- **Recommended fix:** No action needed now; both are documented. Re-check on the next drei/orval upgrade.

## Tooling signals (Phase 0)

- Typecheck: **clean** — `tsc --build` + all four package typechecks pass
- Lint: **clean** — eslint over `bathyscan/src`, `api-server/src`, `tests/e2e` reports 0 problems
- Tests: api-server validation suite **160/160 passed**; unit suites passed in the serialized heavy run; e2e were still running at report time — known e2e instabilities are already tracked as separate tasks (timeline-bar check, four flaky specs, browser-test failures) and are not double-reported here
- Dependency audit: **1 low advisory** (js-yaml — accepted, documented exception)

## Verified and dismissed (checked, not findings)

- `tidalStore.ts:162` `samples[0]!` — guarded by `samples.length === 0` early return at line 155.
- `routes/poe.ts` "missing auth" — `router.use(requireAuth)` at line 60 precedes every route; rate limiting also applied router-wide.
- `routes/ncei.ts:473` SSRF — URL is a fixed constant plus `URLSearchParams`; no user-controlled host.
- `DatasetPanel.tsx` GCS status polling — has `.ok` check, `.catch` (keep-polling), and a 15-minute watchdog.
- `objects.ts` path traversal — object keys map into a flat GCS namespace after `requireAuth` + per-object ACL check; `..` segments are literal key characters, not directory escapes.
- `LandmassMesh.tsx` geometry leak — previous-geometry disposal is present (lines 140-147).
- `trailStore.ts:154-155` mutation — `slice(1)` produces a fresh copy; pushing to it before `set` is immutable-safe.
- `coordinateParser.ts` `!` index accesses — all preceded by emptiness/length guards.

## Deferred / not audited

- End-to-end test flakiness and known e2e failures — already covered by existing project tasks; excluded to avoid double-tracking.
- Poe API payment errors, orphaned photo cleanup, and other issues already tracked as tasks were excluded from findings.
- `artifacts/mockup-sandbox` (dev-only preview server, not deployed) received only the typecheck pass.
- Python BAG parser subprocess internals (`bag_parser.py`) — outside the TS toolchain; not statically audited.
