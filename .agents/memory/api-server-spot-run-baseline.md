---
name: api-server spot-run baseline
description: Known pre-existing test failures in the api-server unit suite as of 2026-07-28, from a clean isolated two-shard run.
---

## Run details
- **Date:** 2026-07-28
- **How:** `npx vitest run --shard=1/2` then `npx vitest run --shard=2/2` in `artifacts/api-server`, via validation command, NODE_OPTIONS=--max-old-space-size=8192
- **Total duration:** ~332 s (shard 1 ≈170 s, shard 2 ≈158 s)

## Shard 1 — GREEN
- **Test Files:** 95/95 passed
- **Tests:** 1352 passed | 11 skipped | 0 failed

## Shard 2 — 2 files failing, 4 tests failing
- **Test Files:** 2 failed | 93/95 passed
- **Tests:** 4 failed | 1364 passed | 4 skipped

## Failing tests (pre-existing as of 2026-07-28)

### File: `src/__tests__/pdf-upload.test.ts` (1 failure)

- **Test:** `POST /api/datasets/upload — PDF contour maps > returns 422 pdf_extract_error for a raster-only PDF with no detectable contours`
- **Failure:** `AssertionError: expected 'PDF rendered as a blank page — check …' to match /no contour lines/i`
- **Root cause:** The server returns the message "PDF rendered as a blank page — check that the file is not encrypted or corrupt" but the test expects a message matching `/no contour lines/i`. The error message wording changed; the test expectation is stale.

### File: `src/__tests__/raster-routes.test.ts` (3 failures)

- **Test 1:** `POST /api/datasets/raster-extract > reports pdf_extract_error via SSE when OCR/tracing fails`
  - `AssertionError: expected 422 to be 200` — endpoint returns HTTP 422 instead of HTTP 200 SSE stream when extraction fails.
  - See memory note [Raster-extract is SSE not JSON](raster-extract-sse-endpoint.md) — errors should come as SSE stage:"error" events with HTTP 200, but the route is returning a plain 422.

- **Test 2:** `POST /api/datasets/raster-extract > returns SSE done event with token, labels, polylineCount, width, height on success`
  - `AssertionError: expected undefined to be defined` — no `stage:"done"` event found in the SSE response (the response body is likely a 422 error page rather than an SSE stream).

- **Test 3:** `POST /api/datasets/raster-extract > accepts .jpg extension and returns SSE done event with token`
  - `AssertionError: expected undefined to be defined` — same as above; SSE done event absent.

## Summary

All 4 failures are in the PDF/raster-upload pipeline — specifically the raster-extract SSE endpoint and the PDF upload error-message wording. These are **not caused by any recent change**; they are pre-existing as of this run date. Do not attempt to fix them in tasks that touch unrelated code.

**Why:** The raster-extract route appears to have been changed to return HTTP 422 directly for errors rather than wrapping them in a `stage:"error"` SSE event, breaking the SSE contract and three of the four raster-route tests.
