---
name: Fake-timer clock reset between tests breaks TTL caches
description: Why vi.useRealTimers() in a global beforeEach breaks tests that accumulate fake time across tests, and the per-file alternative.
---

**Rule:** Never put `vi.useRealTimers()` in a global (setupFile) `beforeEach`. If cross-file fake-timer leaks must be cleaned in a singleFork suite, call `vi.useRealTimers()` at the **top level** of the setup file so it runs once per test file, not before every test.

**Why:** Re-entering fake timers resets the fake clock to the current real time. Tests that rely on cumulative `vi.advanceTimersByTime()` across tests (e.g. to expire a 30s TTL cache between tests) then see only a few ms of elapsed fake time — cached entries from the previous test stay live and every subsequent test gets stale results.

**How to apply:** In Vitest singleFork suites, module registries reset per file but patched globals (fake timers) do NOT. Clean timer leaks at file granularity (top-level setupFile statement), and give every file that calls `vi.useFakeTimers()` its own `afterEach(() => vi.useRealTimers())`.

**Corollary — never rely on cumulative fake time across tests:** Once each test has proper `useFakeTimers`/`useRealTimers` pairing, `advanceTimersByTime` no longer accumulates between tests (each `useFakeTimers` resets the clock to real now). To expire TTL caches from prior tests, keep a monotonically increasing base (`let clockBase = Date.now()`) and in `beforeEach` do `clockBase += <TTL + max intra-test advance>; vi.setSystemTime(clockBase)`.

**Related:** killing a child process synchronously before a pending `stdin.write` surfaces async EPIPE as an uncaught exception — long-lived child-process wrappers must attach a `stdin.on("error")` handler (exit handler already rejects in-flight requests).
