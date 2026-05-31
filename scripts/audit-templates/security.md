---
title: Security Hardening Audit
---
# Security Hardening Audit

## What & Why
BathyScan has several security-sensitive configuration points that drift silently as new routes, middleware, and deployment config are added: the E2E auth-bypass header must be production-gated, the rate-limiter in-memory fallback must still enforce limits in multi-process scenarios, `gunzipBounded` must abort before OOM, the multer extension allowlist must not have grown a loophole, and CORS must not accept wildcard origins on mutating routes. This audit re-checks all of them and fixes any regressions.

## Done looks like
- `requireAuth.ts`: the `x-e2e-user-id` bypass header is rejected in `NODE_ENV=production` and confirmed by a test.
- Rate-limiter: the in-memory fallback enforces the configured request-per-window limit even when the DB store is unreachable; tested in isolation.
- `gunzipBounded`: the 200 MB abort limit fires before the process can OOM; confirmed by a unit test feeding an oversized stream.
- Multer extension allowlist: every extension in the allowlist is intentional; no new extension was added without review; test posts a `.exe` or `.sh` file and asserts 400.
- CORS config: no mutating route (`POST`, `PUT`, `PATCH`, `DELETE`) accepts `Origin: *`; confirm `corsOptions` in `app.ts` or equivalent restricts origins to the configured allow-list for mutating verbs.
- All findings result in either a confirmed-passing test or a tracked fix.

## Out of scope
- Penetration testing or fuzzing beyond the specific vectors listed above.
- Infrastructure-level controls (firewall rules, TLS config).
- Changing authentication providers.

## Steps
1. **Verify `requireAuth.ts` production gate** — Read the middleware source; confirm the bypass is behind `process.env.NODE_ENV !== "production"`. Run the existing test (or add one) with `NODE_ENV=production` to assert the bypass is rejected.

2. **Verify rate-limiter multi-process behaviour** — Read `rateLimit.ts`; confirm the in-memory fallback is used when the DB store is unavailable. Write or run a unit test that disconnects the DB mock and fires requests above the limit; assert 429 responses.

3. **Verify `gunzipBounded` abort limit** — Locate the function (likely in the upload pipeline); confirm the 200 MB cap is enforced. Write or confirm a unit test that feeds a synthetic stream inflating beyond the cap and expects an error thrown before limit is reached.

4. **Audit multer extension allowlist** — List all allowed extensions; compare against the intended set (`.csv`, `.xyz`, `.las`, `.laz`, `.bag`, `.tif`, `.tiff`, `.gpx`, `.nmea`, `.nme`, `.txt`). Post a disallowed file type (e.g. `.exe`) to the upload endpoint and assert 400.

5. **Audit CORS configuration** — Read the CORS setup in `app.ts` or the relevant Express middleware; confirm `Access-Control-Allow-Origin: *` is not returned for `POST`/`PUT`/`PATCH`/`DELETE` responses. Add a test that sends a mutation request from a non-allowlisted origin and asserts CORS rejection.

6. **Document any new findings** — For each gap found, either fix it inline or create a follow-up task with reproduction steps and risk rating.

## Relevant files
- `artifacts/api-server/src/middleware/requireAuth.ts`
- `artifacts/api-server/src/middleware/rateLimit.ts`
- `artifacts/api-server/src/app.ts` (or equivalent Express setup file)
- Upload pipeline file containing `gunzipBounded`
- Multer configuration file / upload route
