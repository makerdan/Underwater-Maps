---
name: Circuit breaker forceOpen for tests
description: Use forceOpen() to trip PoeCircuitBreaker instantly in tests instead of the 5-request slow loop.
---

The old circuit-breaker-trip test fired 5 real (rejected) requests in a loop to move the breaker from `closed` → `open`. With network overhead this added ~15 s per test run.

**Why:** The breaker state is internal to `PoeCircuitBreaker`; there was no way to set it directly from outside the class. Exporting a test helper keeps production code clean while eliminating the wait.

**How to apply:**

1. Add `forceOpen()` to `PoeCircuitBreaker` in `lib/poe/src/circuitBreaker.ts`:
   ```ts
   forceOpen(): void {
     this.state = "open";
     this.openedAt = Date.now();
   }
   ```

2. Export a test helper from the route module (poe.ts):
   ```ts
   export function __forceOpenPoeBreaker() { poeBreaker.forceOpen(); }
   ```

3. In the test, call `__forceOpenPoeBreaker()` at the top of the `beforeEach` that used to run the 5-request loop.

The `lib/poe/src/` directory ships pre-compiled `.js`/`.d.ts` alongside the `.ts` source — after editing `circuitBreaker.ts`, run typecheck so `tsc` regenerates those files.
