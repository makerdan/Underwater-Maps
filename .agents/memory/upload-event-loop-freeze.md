---
name: API server event-loop freeze during browser-path LAZ upload
description: Deterministic ~150-160s full event-loop stall on the api-server during the dropzone upload e2e test; upload stalls at ~88%, all concurrent requests hang
---

During the browser-UI dropzone upload e2e (`file-upload-laz.spec.ts`, noCanvas + seeded terrain), the api-server event loop freezes for ~150–160 s: zero log output, all in-flight requests (upload, /api/surface-conditions, /api/water-temperature) report ~148–161 s responseTime once it unfreezes, and fetch-timeout timers fire late (AbortError). The client shows "Uploading & parsing... 88%" and the "DEV API server unreachable" banner.

Key facts:
- The API-path upload of the same LAZ file completes in ~500 ms, so laz-perf parsing itself is fast (and runs in parseWorker).
- The freeze reproduced on both retries in the same run — deterministic under this test's concurrent overlay-request load, not a one-off.
- Suspects not yet ruled out: sync work in an overlay handler triggered by seeded terrain (poe zone compute on cache miss), pino thread-stream backpressure blocking, or something in the multipart path.

**How to apply:** if this e2e test fails with the "unreachable" banner and ~2 min stall, don't chase the test code — profile the server (e.g. `--cpu-prof` or blocked-at) during the browser-path upload with overlays active.
