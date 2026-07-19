---
name: bucketMonitor singleFork concurrency leak
description: activeProcessCount leaks between test files in singleFork vitest pool; reset must be explicit in beforeEach.
---

**Rule:** Any test file that checks concurrency-cap behavior in `bucketMonitor.ts` must call `__resetProcessConcurrencyForTests()` in `beforeEach`.

**Why:** `activeProcessCount` and `processWaitQueue` are module-level state in `bucketMonitor.ts`. The api-server test suite runs with `singleFork: true` in vitest, so all test files share one process — state leaks between files. If a file that calls `processObject` (e.g. `bucket-monitor-process.test.ts`) runs before `bucket-monitor-concurrency.test.ts` and leaves `activeProcessCount >= PROCESS_CONCURRENCY_CAP (3)`, every new pipeline queues silently and `mockCreateReadStream` is called 0 times instead of 3. The test fails deterministically in the full suite but passes alone.

**How to apply:** 
- Export `__resetProcessConcurrencyForTests` from `bucketMonitor.ts` (sets `activeProcessCount = 0`, clears `processWaitQueue`)
- Import and call it in `beforeEach` of `bucket-monitor-concurrency.test.ts`
- If new concurrency tests are added to other files, apply the same pattern
