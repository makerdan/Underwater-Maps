---
name: Rate-limit memory prefill for fast unit tests
description: Use __prefillRateLimitMemory to set token-bucket state directly instead of sleeping through fill windows in tests.
---

The api-server rate-limit middleware (`rateLimit.ts`) exports `__prefillRateLimitMemory(key, count)` for testing. This lets tests set the bucket counter directly, avoiding real sleep waits.

**Why:** Rate-limit tests that sleep through actual fill windows (e.g. 30s/90s) accumulate to 43+ seconds combined, burning almost the entire singleFork budget for trivial coverage. Prefilling the in-memory map is semantically identical to having made that many requests — the bucket logic is unchanged.

**How to apply:**
- Key format: `i:<route>:<ip>` (IP-based), `u:<route>:<userId>` (user-based)
- Route strings: `terrain-fetch`, `dataset-upload`, `trail-upload`
- Import in test: `import { __prefillRateLimitMemory } from "../../middlewares/rateLimit"`
- Reset between tests with `beforeEach(() => __prefillRateLimitMemory(key, 0))` or just prefill to limit-1 and make one real request
