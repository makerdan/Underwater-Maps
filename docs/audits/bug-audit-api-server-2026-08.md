# Bug & Error Audit Report

**Scope:** API Server artifact only — `artifacts/api-server/src` (~42,400 non-test lines: ~37 route files, ~60 lib files, 9 middlewares). Shared boundaries (`lib/db` schema, `@workspace/api-zod`) were read only where needed to verify findings. Frontend (`artifacts/bathyscan`), e2e specs, `scripts/`, and workspace lib packages were not audited as targets.
**Mode:** report-only — no code, config, test, or dependency changes were made. The only new file is this report.
**Date:** 2026-08-17
**Stack:** Express 5 + TypeScript (strict, ESM), Drizzle ORM (PostgreSQL), Zod validation middlewares (`validateBody`/`validateQuery`/`validateParams`), Clerk auth (`requireAuth` with env-gated e2e bypass), Google Cloud object storage with per-object ACL, Python subprocesses (`bag_parser.py`, `raster_contour.py`), Poe/OpenAI proxy routes. TypeScript gate applies. **React-specific gated categories (hooks deps, effect cleanup, stale closures, render loops) are skipped — no React code in scope.**

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 7 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| 1 | High | Security | `routes/github.ts:87-391`, `lib/github.ts:15-24` | Any authenticated user can read/write/delete repo contents and dispatch workflows using the server-wide `GITHUB_TOKEN` PAT — no per-user authorization, no admin gate, no rate limit |
| 2 | Medium | Security | `routes/catalog-saves.ts:1447,1552,1601` | DELETE/rename/move on my-saves lack `dataMutationRateLimit` while sibling save/retry routes have it |
| 3 | Medium | Security | `routes/user-datasets.ts:290,320`; `routes/catches.ts:290` | Dataset move/rename and signed-upload-URL minting are authenticated writes with no mutation rate limit |
| 4 | Medium | State & data integrity | `routes/me.ts:98-111`; `routes/user-datasets.ts:639-654` | Multi-table account deletion and dataset-delete + marker-unassign run as separate statements with no transaction |
| 5 | Medium | Null/undefined safety | `routes/datasets.ts:1628` | `?resolution=abc` → `parseInt` NaN survives the `Math.max/Math.min` clamp into `buildTerrainGrid` |
| 6 | Low | Error handling | `lib/objectAcl.ts:119` | ACL metadata `JSON.parse(... ) as ObjectAclPolicy` unvalidated — corrupt/legacy metadata throws → 500 instead of controlled deny |
| 7 | Low | Concurrency & shared state | `lib/etaCalibration.ts:14,46-52` | Calibration Map keyed by user-controlled file extension has no key cap and is not in `cacheRegistry` |
| 8 | Low | Async & timing | `routes/terrain-bundles.ts:317-367` | SELECT-then-INSERT race on `(userId, presetId)` → unique-constraint 500 instead of idempotent 202 under concurrent requests |
| 9 | Low | Concurrency & shared state | `lib/efhFetcher.ts:494-522` | No in-flight promise dedupe — cold-start burst triggers parallel duplicate upstream NOAA fetches; `memoryCache` not registered |
| 10 | Low | State & data integrity | `routes/user-datasets.ts:356-389` | Dataset duplicate is INSERT-then-UPDATE without a transaction — partial failure leaves duplicate with the source's embedded `datasetId` |
| 11 | Low | Performance | `routes/me.ts:56-64`; `routes/routes.ts:27-31`; `routes/collections.ts:74-105` | N+1 trail-points loop in export; unbounded per-user SELECTs with no LIMIT |
| 12 | Low | Dead code | `routes/schemas.ts:228-242` | `TerrainSatelliteQuerySchema` validates a route that was removed |

## Findings

### Finding 1 — GitHub proxy routes expose the server-wide PAT to every authenticated user
- **File and line:** `artifacts/api-server/src/routes/github.ts:87-391` (all six routes), `artifacts/api-server/src/lib/github.ts:15-24`
- **Category:** Security
- **Severity:** High
- **Risk:** `getGithubClient()` authenticates every request with the single `GITHUB_TOKEN` environment PAT. All six routes are gated only by `requireAuth` (any valid Clerk session) — there is no `isAdmin()` check, no repo allowlist, no per-user token, and no rate limiter on the mutating routes (`PUT`/`DELETE /repos/:owner/:repo/contents/*path`, `POST .../workflows/:workflow_id/dispatches`). Realistic scenario: any registered user of the app calls `GET /api/github/repos` to enumerate every repository the PAT can access (including private ones), reads their contents, commits or deletes files, and dispatches workflows — acting as the PAT owner with full audit-trail confusion and CI cost. Mitigating factor observed: `GITHUB_TOKEN` is **not** currently present in the environment's secret set, so today every call fails with a controlled 500 ("token is not set"); the exposure is latent and becomes live the moment the secret is added.
- **Recommended fix:** Gate all `/api/github/*` routes behind `isAdmin()` (matching `lib/adminAccess.ts` used by `routes/admin.ts` and the tidal admin route), or scope to an explicit repo allowlist; add a rate limiter to the three mutating routes. If the feature is intended for end users, per-user GitHub OAuth is required instead of a shared PAT.

### Finding 2 — my-saves DELETE/rename/move bypass the mutation rate limiter
- **File and line:** `artifacts/api-server/src/routes/catalog-saves.ts:1447` (DELETE `/datasets/my-saves/:id`), `:1552` (PATCH rename), `:1601` (PATCH move)
- **Category:** Security
- **Severity:** Medium
- **Risk:** Sibling routes in the same file (`POST /datasets/catalog/:id/save`:524, `POST /datasets/my-saves/:id/retry`:1271) apply `dataMutationRateLimit`, but the destructive DELETE and both PATCH routes carry only `requireAuth`. Realistic scenario: a compromised or scripted session loops `DELETE /api/datasets/my-saves/:id` (or floods rename/move) with no quota, destroying a user's saved catalog state and amplifying DB writes far past the intended mutation budget — precisely the abuse the limiter exists to stop on the neighboring routes.
- **Recommended fix:** Add `dataMutationRateLimit` between `requireAuth` and the handler on all three routes, matching the save/retry routes.

### Finding 3 — dataset move/rename and photo-upload-URL minting have no mutation rate limit
- **File and line:** `artifacts/api-server/src/routes/user-datasets.ts:290` (PATCH move), `:320` (PATCH rename); `artifacts/api-server/src/routes/catches.ts:290` (POST `/catch-photos/upload-url`)
- **Category:** Security
- **Severity:** Medium
- **Risk:** In `user-datasets.ts`, `duplicate`/`georef`/`delete` all apply `dataMutationRateLimit`, but `move` and `rename` are `requireAuth`-only — an authenticated session can flood folder/rename updates without quota (DB write amplification, cross-device sync churn). In `catches.ts`, every other catch mutation is limiter-protected, but the signed-upload-URL route is not: each call creates a fresh GCS signed URL, so a scripted session can mint unbounded upload capacity and push storage/egress cost until the orphaned-photo cleanup job catches up (24 h window).
- **Recommended fix:** Add `dataMutationRateLimit` to both PATCH routes; add a limiter (mutation-tier or a dedicated upload-URL limiter) to `POST /catch-photos/upload-url`.

### Finding 4 — account deletion and dataset-delete cascade are not transactional
- **File and line:** `artifacts/api-server/src/routes/me.ts:98-111` (DELETE `/me`); `artifacts/api-server/src/routes/user-datasets.ts:639-654` (DELETE `/user/datasets/:id`)
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** `DELETE /me` deletes across five tables (trail points → trails → markers → datasets → settings) as separate sequential statements. A DB failure mid-sequence returns 500 with the account half-deleted (e.g. trails gone, markers/datasets remain) — a bad state for an account-deletion/privacy flow, and the user has no signal about which data survived. Similarly, dataset delete commits the row deletion, then unassigns referencing markers in a second statement; the code comment notes `markers.dataset_id` has no DB-level FK, so a failure after the first statement leaves markers permanently pointing at a nonexistent dataset, and a retry returns 404 without ever re-running the cascade — the dangling references become unreachable by any recovery path.
- **Recommended fix:** Wrap each route's statements in `db.transaction(async (tx) => { ... })` so both flows are all-or-nothing.

### Finding 5 — NaN survives the terrain resolution clamp
- **File and line:** `artifacts/api-server/src/routes/datasets.ts:1628`
- **Category:** Null/undefined safety
- **Severity:** Medium
- **Risk:** `const resolution = rawRes ? Math.max(32, Math.min(512, parseInt(String(rawRes), 10))) : 256;` — for `?resolution=abc`, `parseInt` returns NaN, and `Math.min`/`Math.max` both propagate NaN, so `buildTerrainGrid(id, NaN, …)` runs with a NaN resolution. Any grid-dimension loop bounded by NaN executes zero iterations, so the route can return a degenerate/empty grid with HTTP 200 (or fail deeper in the pipeline) instead of rejecting the malformed parameter. The intent is clearly to handle this: the `GET /terrain/land` handler in the same file (`:1928`) explicitly guards with `isNaN(rawSizeNum) ? 128 : rawSizeNum` before its clamp. This route is the outlier.
- **Recommended fix:** Mirror the `terrain/land` pattern: parse first, fall back to 256 when `Number.isNaN(parsed)`, then clamp — or validate `resolution` via a Zod query schema like the neighboring routes.

### Finding 6 — object ACL metadata parsed with an unvalidated cast
- **File and line:** `artifacts/api-server/src/lib/objectAcl.ts:119` (callers: `lib/objectStorage.ts:98`, `routes/catches.ts:80`)
- **Category:** Error handling
- **Severity:** Low
- **Risk:** `getObjectAclPolicy` does `JSON.parse(aclPolicy as string) as ObjectAclPolicy` with no shape validation and no try/catch. If the custom metadata is ever corrupt, truncated, or written by an older/other tool (valid string, invalid JSON), `JSON.parse` throws and the ACL check path 500s instead of returning a controlled deny; a wrong-but-parseable shape (e.g. unknown `aclRules` group type) later throws inside `createObjectAccessGroup`. Failure surface is the object-read authorization path (`GET /objects/*objectPath`), so one bad metadata blob turns a should-be-403 into repeated 500s for that object.
- **Recommended fix:** Parse inside try/catch and validate with a small Zod schema; on parse/shape failure, log and return `null` (treated as "no policy" → deny for non-public requests), keeping the failure closed.

### Finding 7 — ETA calibration Map grows without bound on user-controlled keys
- **File and line:** `artifacts/api-server/src/lib/etaCalibration.ts:14` (`extensionDurationHistory`), populated at `:46-52`; keys originate from `routes/datasets.ts:1094` (`path.extname(fileName).toLowerCase()`)
- **Category:** Concurrency & shared state
- **Severity:** Low
- **Risk:** Each per-key array is capped at 10 samples, but the Map itself has no key cap, TTL, or `registerCache()` registration (contrast `datasets.ts` uploadJobs, which registers). The key is the uploaded file's extension — attacker-controlled via filename — so every upload with a novel extension adds a permanent heap entry for the process lifetime. Growth is throttled by `datasetUploadRateLimit`, so this is slow-burn heap creep rather than a fast DoS; it also drifts from the project's cacheRegistry convention that module-level caches be registered for test isolation.
- **Recommended fix:** Normalize keys to the known-supported extension set (map everything else to `"other"`), or cap the Map (e.g. LRU at ~50 keys); call `registerCache(() => extensionDurationHistory.clear())`.

### Finding 8 — terrain-bundle POST has a SELECT-then-INSERT race
- **File and line:** `artifacts/api-server/src/routes/terrain-bundles.ts:317-326` (SELECT), `:359-367` (INSERT)
- **Category:** Async & timing
- **Severity:** Low
- **Risk:** Two concurrent `POST /terrain/bundles` for the same preset (double-click, client retry) can both observe "no existing job" and both INSERT. The schema's unique constraint `terrain_bundle_jobs_user_preset_uniq` (verified in `lib/db/src/schema/terrain-bundle-jobs.ts:37-40`) prevents duplicate rows and duplicate background jobs, but the loser's INSERT throws a raw unique-violation which `asyncHandler` surfaces as a 500 — the user sees an error even though their download is in fact queued. (The `inFlightJobs` set at `:151` dedupes by jobId only, so it cannot help across two prospective rows.)
- **Recommended fix:** Use `.onConflictDoNothing()` (or catch the unique-violation error code) and re-SELECT the winning row, returning the same idempotent 202 the existing-job branch already produces.

### Finding 9 — EFH fetcher has no in-flight dedupe; cache unregistered
- **File and line:** `artifacts/api-server/src/lib/efhFetcher.ts:494` (`let memoryCache`), `:513-522` (check-then-fetch)
- **Category:** Concurrency & shared state
- **Severity:** Low
- **Risk:** `fetchNoaaAlaskaEfh()` checks `memoryCache`, then disk, then live-fetches all GOA layers in parallel — with no in-flight promise guard. A burst of concurrent first requests after a cold start (memory empty, disk cache absent/stale) all pass the null checks and each independently fires the full set of NOAA ArcGIS layer queries, multiplying upstream load exactly when the upstream may be rate limiting, and producing inconsistent success/failure across callers. The module also skips `registerCache()` (it is a `let` variable rather than a Map, which is likely why the cacheRegistry lint does not catch it), diverging from the project convention for test isolation.
- **Recommended fix:** Store an in-flight `Promise<EfhFeature[] | null>` and return it to concurrent callers (same pattern as the reverse-geocode in-flight cache); register a clear function with `registerCache`.

### Finding 10 — dataset duplicate is a two-step write without a transaction
- **File and line:** `artifacts/api-server/src/routes/user-datasets.ts:356-368` (INSERT), `:386-389` (UPDATE rewriting embedded `datasetId`)
- **Category:** State & data integrity
- **Severity:** Low
- **Risk:** The duplicate row is committed first, then a second UPDATE stamps the copied `terrainJson`/`overviewJson` with the new row's id. A failure between the two leaves a committed duplicate whose embedded payload ids still point at the source dataset. Impact is bounded — the code comment notes the client's load path re-brands the id on read — but the stored payload is internally inconsistent for any future tooling that trusts it, and the request returns 500 despite the row existing (a retry then creates a second copy).
- **Recommended fix:** Perform INSERT and UPDATE in one `db.transaction`, or compute the rewritten JSON before insert by generating the id client-side of the query (e.g. `crypto.randomUUID()` supplied to `.values()`), making it a single statement.

### Finding 11 — unbounded per-user reads and an N+1 loop
- **File and line:** `artifacts/api-server/src/routes/me.ts:56-64` (per-trail points loop); `artifacts/api-server/src/routes/routes.ts:27-31` and `artifacts/api-server/src/routes/collections.ts:74-105` (no `.limit()`)
- **Category:** Performance
- **Severity:** Low
- **Risk:** `GET /me/export` issues one query per trail (`Promise.all` over trails) — a user with hundreds of trails fires hundreds of concurrent queries and assembles all points in memory in one response. `GET /routes` and the collections member-resolution helper select all matching rows with no LIMIT; both are user-scoped, so the blast radius is a single hoarder user's request latency and server memory, not cross-user impact — hence Low.
- **Recommended fix:** Export: fetch all points with one `inArray(trailId, ids)` query and group in memory. List endpoints: add a defensive `.limit()` (with the cap mirrored in the client) or pagination.

### Finding 12 — dead schema for a removed route
- **File and line:** `artifacts/api-server/src/routes/schemas.ts:228-242` (`TerrainSatelliteQuerySchema`, `TerrainSatelliteQuery`)
- **Category:** Dead code
- **Severity:** Low
- **Risk:** The satellite-tile route was removed (`routes/datasets.ts:60` comment confirms the intentional removal), but its query schema and type remain exported. No runtime risk; it misleads readers into thinking the endpoint exists and rots as the surrounding conventions evolve. Note: this schema also contains the same NaN-producing `parseInt` transform as Finding 5 — deleting it removes that latent copy too.
- **Recommended fix:** Delete the schema and type (and any now-unused imports).

## Checked and cleared (verified non-findings worth recording)

- **`BUCKET_MONITOR_ADMIN` dev shortcut** (`lib/adminAccess.ts:8-17`): flagged as a candidate "any user becomes admin" hole, but `lib/env.ts:143-159` treats the flag as a **critical startup failure** in production (`NODE_ENV=production` or `REPLIT_DEPLOYMENT`) and `validateStartupEnv()` throws — fail-closed as designed.
- **Unchecked upstream response casts** (`routes/tidal.ts:174-197`, `lib/noaaWeatherFetcher.ts:250-275,296-330`): every call site is wrapped in try/catch returning `null` with optional chaining throughout, so malformed USGS/NOAA payloads degrade to the documented "unavailable" path rather than 5xx.
- **Injection/SSRF/path traversal sweep:** Python subprocesses use fixed argv (`lib/bagWorkers.ts`, `lib/pdfContourRaster.ts`) with the BAG path passed over stdin, not shell-evaluated; chunk-upload paths are built from schema-validated server-issued ids; object reads decode and reject `..`/absolute paths before joining the private dir and enforce per-object ACL; all SQL in scope is Drizzle-parameterized with fixed raw fragments; federated-search fetchers use fixed allowlisted URLs. No injection findings.
- **IDOR sweep:** all user-data routes (datasets, saves, markers, catches, collections, folders, routes, trails, presets, settings) consistently include `userId`/`clerkUserId` ownership predicates in their queries.
- **NaN clamp on `GET /terrain/land`** (`routes/datasets.ts:1928`): explicitly `isNaN`-guarded — correct; used as the reference pattern for Finding 5.
- **Copernicus land-DEM disk cache** (`lib/copernicusDem.ts:46-54`): `JSON.parse` of a corrupt cache file is caught and treated as a cache miss; only a valid-JSON shape drift (self-written files only) would slip the cast — not a realistic failure.
- **Upload pipeline auth:** all seven upload/raster endpoints carry `requireAuth` plus upload-tier rate limits; chunk uploads verify server-issued `uploadId`. The unauthenticated `POST /datasets/bbox-query` / `point-radius-query` are intentional public catalog queries behind `catalogReadRateLimit`.
- **Poe/AI routes:** router-wide `requireAuth` + rate limiter (`routes/poe.ts:73-75`). (Body-size caps and env-var validation hardening for these routes are already tracked separately in task #2766.)
- **Terrain-bundle GCS-write vs DB-complete gap** (`routes/terrain-bundles.ts:252-257`): cannot be one ACID transaction across GCS+DB by nature; the POST handler already reconciles (`complete` + missing bundle → re-queue; `error` → retry), so the remaining window is handled.

## Tooling signals (Phase 0)

- **Typecheck:** api-server clean. (Workspace run also surfaced 6 pre-existing errors in `artifacts/bathyscan` from in-flight task #4127's offline-help work — out of scope, not caused by or related to this audit.)
- **Lint:** clean for `artifacts/api-server` (runs as part of the fast validation tier; no api-server findings reported).
- **Tests:** not re-run for this audit per plan. The most recent api-server unit baseline is green (both shards, per `.agents/memory/api-server-spot-run-baseline.md`); the only live baseline failures are the puzzle-e2e `toSatisfy` assertion and plan-archive gate noise, both pre-existing and documented in `docs/audits/bug-audit-preexisting-2026-08.md` — see that report rather than re-investigating here.
- **Dependency audit:** `pnpm audit --audit-level=moderate` — **no known vulnerabilities**.

## Deferred / not audited

- **React-gated categories** (hooks dependencies, effect cleanup, stale closures, render loops): skipped — no React code in the api-server scope.
- **Frontend, e2e specs, `scripts/`, workspace lib packages:** out of scope per task; `lib/db` schema was read only to verify Finding 8's unique constraint.
- **Pre-existing test failures:** covered by `docs/audits/bug-audit-preexisting-2026-08.md`; intentionally not re-investigated.
- **`GITHUB_TOKEN` production configuration:** whether the secret exists in the production deployment could not be verified from the workspace (it is absent from the development secret set); Finding 1's severity assumes it may be added.

## Suggested fix order

1. **Finding 1 (High)** — gate the GitHub proxy behind admin/allowlist before `GITHUB_TOKEN` is ever provisioned; smallest change with the largest risk reduction.
2. **Findings 2 + 3 (Medium)** — one small PR adding the mutation rate limiter to the six uncovered routes; mechanical and low-risk.
3. **Finding 4 (Medium)** — wrap `DELETE /me` and dataset-delete cascade in transactions; account deletion is the highest-integrity flow in the set.
4. **Finding 5 (Medium)** — NaN guard on the terrain resolution param (one-line fix mirroring the existing pattern); fold in Finding 12's dead-schema deletion since it removes the same latent transform.
5. **Finding 6 (Low)** — harden ACL metadata parsing to fail closed.
6. **Findings 8 + 10 (Low)** — idempotent bundle creation and transactional duplicate; both are small route-local changes.
7. **Findings 7 + 9 (Low)** — cache hygiene (key normalization + registration, in-flight dedupe).
8. **Finding 11 (Low)** — export/list query shape; do opportunistically when touching those routes.
