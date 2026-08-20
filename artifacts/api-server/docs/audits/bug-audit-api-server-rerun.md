# Bug & Error Audit Report — API Server Re-audit

**Scope:** Current `artifacts/api-server` Express/TypeScript server checkout after the deployment-build repair. The audit covered server entry points; routers and mutation middleware; Clerk authentication and approval; admin authorization; rate limits; Zod request/response validation; PostgreSQL ownership queries; object storage and ACLs; upload, archive, worker, and subprocess pipelines; caches; and upstream integrations.

**Mode:** Report-only — no source, configuration, dependency, or test changes were made.

**Date:** 2026-08-20

**Stack:** Node.js, TypeScript, Express 5, Clerk, Drizzle/PostgreSQL, Google Cloud Storage, Multer, Zod, Python worker/subprocesses, and Vitest. React-specific checks (hooks, effects, render behavior, client state) were explicitly skipped: this artifact is not a React application.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| 1 | High | Async & timing / concurrency | `src/lib/bagWorker.ts:102-123, 218-314` | A hung BAG parser blocks the singleton forever and the queue has no bound. |
| 2 | Medium | Security / performance | `src/lib/tarDetect.ts:100-121, 129-144` | Tar extraction has no entry-count or extraction-work limit. |
| 3 | Medium | Input validation / performance | `src/routes/poe.ts:1420-1429, 1533-1551, 1619-1648` | Classification accepts oversized or malformed model input shapes and forwards arbitrary-sized image data upstream. |
| 4 | Medium | Input validation / performance | `src/routes/poe.ts:2047-2064, 2078-2119` | AI-query prompt fields have no per-message or aggregate input budget. |
| 5 | Medium | State & data integrity / security | `src/routes/catches.ts:63-89, 167-181` | Concurrent callers can both claim the same unowned uploaded photo. |

## Findings

### Finding 1 — BAG worker can stall all BAG parsing indefinitely

- **File and line:** `artifacts/api-server/src/lib/bagWorker.ts:102-123, 218-314`
- **Category:** Async & timing / concurrency
- **Severity:** High
- **Risk:** `BagWorkerProcess` serializes every parse through one persistent Python subprocess. Each caller is appended to `queue` with no job-count, byte, or wait-time limit. More importantly, there is no per-request deadline after the path is written to the worker's stdin. If `bag_worker.py`, `h5py`, or a malformed-but-accepted BAG parse stops producing output without exiting, `active` remains set indefinitely and `_next()` is never reached. The global Express response timeout does not cancel this worker request. A single approved uploader can leave subsequent BAG uploads waiting forever; concurrent upload traffic can also retain an unbounded queue of request closures and temporary-file paths.
- **Recommended fix:** Add a bounded, observable queue and a hard parse deadline. On timeout, kill and restart the child process, reject the active request and drain/reject queued work with a retryable response. Apply a global queue/concurrency quota rather than relying only on the per-IP upload rate limit, and add a regression test using a worker that never emits a protocol frame.

### Finding 2 — Tar extraction permits an entry-count denial of service

- **File and line:** `artifacts/api-server/src/lib/tarDetect.ts:100-121, 129-144`; reached by `artifacts/api-server/src/routes/datasets.ts:1261-1294, 2210-2229`
- **Category:** Security / performance
- **Severity:** Medium
- **Risk:** The gzip path caps decompressed tar input at 200 MB, but both extraction helpers hand every archive entry to `tar.x` and append every path to an in-memory array. They do not enforce an entry limit, extraction deadline, cumulative work budget, or a permitted entry-type policy. A valid tar containing hundreds of thousands of empty/tiny entries remains below the decompressed-byte cap but consumes CPU, temporary-directory inodes, and memory for the returned `entries` array. In the direct upload path, this work occurs before responding that tar uploads are unsupported.
- **Recommended fix:** Extract through a bounded entry filter/stream that rejects archives above a conservative entry count, rejects non-regular files and unexpected paths, caps cumulative extracted bytes, and has a deadline. Preserve cleanup in a `finally` block and return a specific validation error when a limit is exceeded.

### Finding 3 — Classification route lacks a model-input budget

- **File and line:** `artifacts/api-server/src/routes/poe.ts:1420-1429, 1533-1551, 1619-1648`
- **Category:** Input validation / performance
- **Severity:** Medium
- **Risk:** `ClassifyBodySchema` accepts any non-empty `gridBase64`, arbitrary-length numeric arrays, and unrestricted number values for `widthFull` and `heightFull`. The route hashes the supplied data and forwards `gridBase64` to the vision provider; when the dimensions and array length match, it also builds a tile plan from caller-controlled dimensions. The 10 MB JSON parser limit and 30-per-minute authenticated-user rate limit reduce the blast radius but still permit repeated near-limit requests, unnecessary parsing/hashing, and substantial Poe/OpenAI vision cost. A caller can also submit a non-image payload or dimensions that are non-integers, non-finite, or far outside the terrain-client contract.
- **Recommended fix:** Require a supported image data URL and cap its encoded and decoded size. Require positive safe-integer dimensions with an explicit maximum; cap `depthsFull` to the maximum permitted grid area, require exact array/dimension agreement, and validate all supplied values are finite. Cap `depths32` at 1,024 elements and reject inconsistent inputs before cache hashing, tile planning, or provider calls.

### Finding 4 — AI query route has no prompt-size budget

- **File and line:** `artifacts/api-server/src/routes/poe.ts:2047-2064, 2078-2119`
- **Category:** Input validation / performance
- **Severity:** Medium
- **Risk:** The query schema limits history to 50 entries but does not limit `userMessage`, each `history[].content`, `previousResponseId`, or the optional `context` record. The handler forwards the last 10 history items plus the user message to the provider and retries provider calls up to three times. An approved user can therefore submit near the 10 MB body cap as prompt text, creating avoidable token cost and latency even though output tokens are capped. The current per-user 30/minute route limit is not a substitute for a provider-input budget.
- **Recommended fix:** Set conservative maximum lengths for the user message, each history message, IDs, and supported context fields; calculate and enforce a total prompt-character/token budget after retaining the final history window. Reject over-budget requests before creating the provider client or entering retries, and expose a clear 400/413-style validation response.

### Finding 5 — Photo ownership claim is a read-then-write race

- **File and line:** `artifacts/api-server/src/routes/catches.ts:63-89, 167-181`
- **Category:** State & data integrity / security
- **Severity:** Medium
- **Risk:** `applyPhotoAcls` treats absent ACL metadata as an unclaimed object. It reads that metadata, then independently calls `setObjectAclPolicy`. Two authenticated callers who possess the same fresh signed-upload object path can both observe `null`, both proceed to set different owners, and both insert catch records. The final metadata writer owns the photo, leaving the other user's newly-created catch pointing at a photo they can no longer read. This is a tenant-ownership/data-integrity race, not an authorization bypass of existing owned objects.
- **Recommended fix:** Make the first claim conditional and atomic: use an object-generation/metageneration precondition or a durable database claim row with a unique object key, then verify the claimed owner before inserting the catch. Return a conflict/forbidden response to the losing claimant and add a concurrent two-user regression test.

## Tooling signals (Phase 0)

- **Typecheck:** `pnpm --filter @workspace/api-server run typecheck` passed with no TypeScript errors.
- **Lint/static:** `pnpm exec eslint artifacts/api-server/src` passed with no lint output.
- **Focused API-server tests:** `pnpm --filter @workspace/api-server run test:validation` passed: 14 files, 223 tests, in 14 seconds.
- **Full API-server unit baseline:** `pnpm --filter @workspace/api-server run test:unit` started normally and did not reproduce the prior Vite cache-directory startup block. The environment's five-minute shell limit stopped it before it produced a final result; at its latest emitted progress it had 60 passing files, 1,069 passing tests, and 4 skipped tests. This is an incomplete tooling signal, not a product test failure, so the flaky-test retry rule did not apply.
- **Dependency audit:** `pnpm audit --audit-level=moderate` reported “No known vulnerabilities found.”
- **Required report validation:** `test-fast` passed in 68.4 seconds. Its API route-schema, typecheck, and guard steps passed; it emitted two pre-existing BathyScan lint warnings outside this API-server-only audit scope.

## Audit coverage, cleared candidates, and deferred checks

### Security-sensitive coverage

- **Authentication and approval:** Cleared. `requireAuth` fails unauthenticated requests closed, invokes the approval gate for real Clerk sessions, and refuses to start in production when the E2E bypass is enabled (`src/middlewares/requireAuth.ts:12-20, 72-99`). `requireApproved` treats database errors as errors rather than allowing a pass-through (`src/middlewares/requireApproved.ts:102-185`).
- **Admin access:** Cleared. The admin routers apply `requireAuth` and verify the caller through the shared admin check before every reviewed privileged mutation.
- **Mutation authorization and tenant ownership:** Cleared for the reviewed marker, catch, route, collection, folder, preset, user-dataset, upload-job, settings, and NCEI-save paths. Their mutations pair resource identifiers with `userId` or perform an equivalent owner lookup. Finding 5 is the remaining first-claim race for previously unowned photo objects.
- **Rate limits and request validation:** Present on reviewed costly and mutation paths. The confirmed exceptions are semantic/model-input budgets in Findings 3 and 4, not missing authentication or a missing generic JSON body size limit.
- **Storage access:** Cleared for object-path traversal. Object paths are decoded, normalized, and rejected if they are absolute, dot-only, or upward-traversing before a bucket key is formed (`src/lib/objectStorage.ts:137-182`); reads are ACL-gated (`src/routes/objects.ts:13-45`). ACL metadata parsing is not schema-validated (`src/lib/objectAcl.ts:111-120`), but only server-written policy JSON reaches that field in the audited upload flow, so this was recorded as a hardening candidate rather than a verified vulnerability.
- **Filesystem, archives, and subprocesses:** BAG command construction uses a fixed `python3` executable and a module-resolved script rather than caller-provided command text. The installed `tar` 7.5.22 default extraction mode strips absolute/`..` paths and prevents unsafe symlink traversal; path traversal was therefore cleared. The resource-bound gaps remain Findings 1 and 2.
- **External services:** Reviewed Poe/OpenAI, NOAA, NCEI, weather, and object-storage boundaries. Most use `AbortSignal` timeouts and route errors through `asyncHandler`/the global error handler. Findings 3 and 4 cover the provider-cost inputs that remain insufficiently bounded.

### Operational category passes

| Audit category | Result |
|---|---|
| Null / undefined safety | Reviewed optional accesses, parsed response handling, and array access around routes, storage, upload parsing, and upstream clients. No additional verified nullability crash found. |
| Async & timing | One confirmed worker-stall finding (Finding 1). Startup jobs, upload cleanup, bucket monitoring, and most upstream requests have explicit error/overlap handling. |
| Error handling | Express has a global error handler for parser and internal failures and a global request ceiling. No confirmed route-level unhandled-error path beyond the worker lifecycle issue. |
| Type safety | Typecheck passes. Assertions and `any` sites were traced at server boundaries; no additional runtime type mismatch was verified. |
| State & data integrity | One confirmed cross-user ACL first-claim race (Finding 5). Owner-scoped database mutations otherwise passed the reviewed data-flow checks. |
| Security | Authentication, approval, admin, validation, storage, archive, and subprocess boundaries were audited first. Findings 2–5 are the confirmed remaining risks. |
| Performance | One archive-work limit issue and two provider-input budget issues are confirmed. No React render checks apply. |
| Concurrency & shared state | BAG queue/timeout and photo claiming are confirmed. In-memory cache registry behavior was reviewed; no cache correctness defect was verified from the current code alone. |
| Dead / unreachable code | ESLint is clean; no confirmed dead server branch found in the audited paths. |
| Dependency hygiene | Moderate-or-higher dependency audit is clean. |

### Deferred / not audited

- The BathyScan web app, Playwright/e2e project, workspace libraries, and scripts were not primary audit targets.
- React-specific audit checks were skipped because the API server has no React rendering layer.
- The full sharded API-server unit suite did not complete within the shell execution ceiling. Its incomplete run is explicitly not reported as a failure.
- This is source-and-tooling audit evidence, not a production traffic/load test. Provider quotas, cloud-object metadata preconditions, and archive limits should be validated in the dedicated fix tasks.

## Prioritized suggested-fix order

1. **Finding 1 — BAG worker timeout and bounded queue.** A single stalled parser can prevent every later BAG upload from completing.
2. **Finding 2 — Bounded tar extraction.** Reject pathological archives before temporary-disk, inode, or CPU pressure can affect upload capacity.
3. **Finding 3 — Classification input contract.** Establish strict terrain and image budgets before external vision calls.
4. **Finding 4 — Query prompt budget.** Bound provider cost and latency for the text/tool route.
5. **Finding 5 — Atomic photo claim.** Prevent inconsistent photo ownership and broken catch-photo links under concurrent requests.

Each approved item should be implemented as a separate task with a focused reproduction and regression guard.