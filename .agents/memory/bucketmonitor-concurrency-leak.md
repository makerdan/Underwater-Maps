---
name: bucketMonitor concurrency test under load
description: bucket-monitor-concurrency.test.ts fails in the full singleFork suite because settle(10) is not enough time for fs.promises.mkdir I/O to complete at position 132/155 with 6.9 GB RSS.
---

**Rule:** Any singleFork test that gates on a condition after real async I/O must use condition-based polling, not a fixed `settle(N)` round count.

**Why:** The api-server singleFork suite runs 155 files in one process. By position ~132/155 the heap is at ~6.9 GB RSS. Under that load, `setTimeout(0)` ticks do not reliably drain all pending I/O callbacks — `fs.promises.mkdir` (called inside `runProcessPipeline` before `createReadStream`) can take more than 10 ticks to complete. `settle(10)` gives 0 `createReadStream` calls instead of 3.

**Fix applied in `bucket-monitor-concurrency.test.ts`:**
- Added `waitFor(condition, 3000ms)` helper that polls every 10ms until condition is true or times out.
- Replaced `await settle()` before the CAP assertion with `await waitFor(() => gcsMocks.mockCreateReadStream.mock.calls.length >= PROCESS_CONCURRENCY_CAP)`.

**How to apply:**
- For any future concurrency or timing test in the api-server singleFork suite that checks a condition after async I/O, use `waitFor` (condition-based with timeout) rather than `settle(N)` (fixed rounds).
- `__resetProcessConcurrencyForTests()` is still correct and necessary in `beforeEach` to reset the module-level `activeProcessCount` and `processWaitQueue` state that leaks between files.
