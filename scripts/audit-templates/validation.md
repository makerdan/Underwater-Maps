---
title: Validation Stack Audit
---
# Validation Stack Audit

## What & Why
Every validation layer across BathyScan — Zod schemas, route-level safeParse, file-upload pipeline, multer limits, worker-thread error propagation, rate-limiter fallback, auth-bypass guard, frontend form schemas, and cross-layer constraint symmetry — needs a periodic sweep to catch gaps introduced by new routes, parsers, or schema changes. Previous audits and live incidents have identified specific failure modes in each layer; this audit re-checks all of them.

## Done looks like
- Every API route in `routes.ts`, `markers.ts`, `datasets.ts`, `settings.ts`, `ncei.ts`, and `me.ts` has request input validated via `safeParse`/`parse` from `@workspace/api-zod`; no local one-off schemas.
- `GET /datasets` and `GET /settings` response-parse failures are caught and return a structured 500, not a crash.
- `gunzipBounded` 200 MB decompression cap fires before OOM and has a passing unit test.
- Multer 6 MB per-chunk limit returns 413 with the standard error shape when exceeded.
- `parseWorker.ts` error propagation returns a structured 422 (not 500) for each supported format given a malformed file.
- The `requireAuth.ts` E2E-bypass header is rejected when `NODE_ENV=production`.
- The rate-limiter in-memory fallback enforces limits even when the DB mock is disconnected.
- Frontend `markerFormSchema` constraints (label ≤ 60 chars, notes ≤ 280 chars, coordinate ranges, marker type enum) match the server-side `@workspace/api-zod` schema field-by-field; any future drift fails a test immediately.
- All gaps found are covered by a regression test so they cannot recur silently.

## Out of scope
- Changing the public API contract or response shapes.
- E2E browser-level form validation (covered by separate E2E tasks).
- Fixing unrelated pre-existing CI failures.

## Steps
1. **Audit `routes.ts`, `markers.ts`, `datasets.ts`, `settings.ts`, `ncei.ts`, `me.ts`** — Scan each file for inline Zod objects not imported from `@workspace/api-zod`, manual `parseFloat`/type-coercion, and missing `safeParse` guards. Migrate all to shared schemas and add route tests (valid body → 200, missing required field → 400, wrong type → 400).

2. **Harden `GET /datasets` and `GET /settings` response parsing** — Wrap `.parse()` calls on DB results in try/catch, emit structured `{ error: "internal", details: "..." }` 500 responses, add tests with a mocked DB row that deliberately violates the schema.

3. **Unit-test `gunzipBounded` size cap** — Create a synthetic gzip stream that inflates beyond 200 MB and confirm the function throws the expected error before reaching the limit.

4. **Test multer 6 MB chunk limit** — Post a 7 MB payload to the chunked upload endpoint and assert a 413 response with the standard error shape.

5. **Test `parseWorker.ts` error propagation** — For each supported format (CSV, LAZ, BAG, GeoTIFF), create a fixture file with a truncated or malformed magic number and confirm the endpoint returns a structured 422.

6. **Test production guard on E2E auth-bypass header** — Run `requireAuth.ts` with `NODE_ENV=production`; assert a request with `x-e2e-user-id` returns 401, not 200.

7. **Test rate-limiter in-memory fallback** — In a unit test for `rateLimit.ts`, mock the DB pool to throw on query, fire enough requests to exceed the in-memory limit, assert 429 (not silent pass-through).

8. **Cross-layer constraint symmetry test** — Import both `markerFormSchema` (frontend) and `PostMarkersBody` (server-side from `lib/api-zod`) in one test file; assert they agree on label max, notes max, marker type enum values, and coordinate range.

## Relevant files
- `artifacts/api-server/src/routes/routes.ts`
- `artifacts/api-server/src/routes/markers.ts`
- `artifacts/api-server/src/routes/datasets.ts`
- `artifacts/api-server/src/routes/settings.ts`
- `artifacts/api-server/src/routes/ncei.ts`
- `artifacts/api-server/src/routes/me.ts`
- `artifacts/api-server/src/middleware/requireAuth.ts`
- `artifacts/api-server/src/middleware/rateLimit.ts`
- `artifacts/api-server/src/parseWorker.ts`
- `lib/api-zod/src/index.ts`
- `artifacts/bathyscan/src/lib/markerFormSchema.ts`
