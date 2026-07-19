---
name: Poe disk-cache cross-run isolation
description: How ZONE_CACHE_DIR and UPSCALE_CACHE_DIR are isolated per vitest run to prevent cross-run cache contamination.
---

# Poe disk-cache cross-run isolation

## The rule
`ZONE_CACHE_DIR` and `UPSCALE_CACHE_DIR` in `poe.ts` now read from env vars:
- `POE_ZONE_CACHE_DIR` (fallback: `/tmp/zone-cache`)
- `POE_UPSCALE_CACHE_DIR` (fallback: `/tmp/upscale-cache`)

`src/__tests__/setup.ts` sets both vars at module-load time to pid-unique paths
(`/tmp/zone-cache-test-<pid>`, `/tmp/upscale-cache-test-<pid>`). Every `vitest`
invocation gets its own isolated directory; entries from a prior run are in a
different directory and are never visible.

**Why:** poe.ts stores results in /tmp dirs that survive between process runs.
Tests that expect a cache miss would get a false cache-hit from a prior run's
leftover files, causing intermittent failures impossible to reproduce in isolation.

**How to apply:**
- Cross-run contamination: solved structurally — no manual cleanup needed.
- Within-run test-to-test contamination: still call `__clearUpscaleCaches()` and
  `__clearZoneAndDatasetCaches()` in `beforeEach` of any test file that exercises
  cache-miss paths (poe.test.ts and poe-fallback.test.ts already do this).
- Any test file that uses the disk zone-cache dir directly (e.g. for writing
  fixture files) must read `process.env["POE_ZONE_CACHE_DIR"]` rather than
  hardcoding `/tmp/zone-cache` — see zone-cache-isolation.test.ts and
  zone-cache-hydrate.test.ts for the pattern.
