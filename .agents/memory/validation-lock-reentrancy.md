---
name: Validation lock reentrancy
description: Double-wrapped validation-lock (workflow + npm script) self-deadlocks; nested wrappers skip acquisition via VALIDATION_LOCK_HELD_PID.
---

The test-e2e workflow wraps `scripts/validation-lock.mjs`, and the `test:e2e` npm script wraps it again — the inner wrapper waited forever on the lock its own ancestor held.

**Why:** lock was non-reentrant; the workflow appeared "stuck" with no output after acquiring the lock.

**How to apply:** the lock holder exports `VALIDATION_LOCK_HELD_PID`; a nested wrapper that sees a live ancestor pid in that var skips acquisition and logs "lock already held by ancestor pid". Don't remove this env plumbing; when adding new lock-wrapped commands, avoid double-wrapping or rely on this reentrancy.
