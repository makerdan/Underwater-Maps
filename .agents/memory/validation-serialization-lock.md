---
name: Validation serialization lock
description: How concurrent validation steps are serialized to prevent load-induced budget breaches
---
Heavy validation commands (typecheck, lint, test-unit, test-settings-validation, test-e2e-palette) and the root `test:e2e` script are wrapped in `node scripts/validation-lock.mjs -- <cmd>`, a global exclusive lock at `.local/validation-serial.lock` with dead-pid stale reclaim.

**Why:** the validation harness runs steps concurrently on one machine; run budgets in `tests/timeout-guard/budgets.json` are calibrated for an idle machine, so parallel suites breached budgets (e.g. test-unit 900 s) with all tests passing. Serialization also removes the codegen api.ts regeneration race and e2e port contention.

**How to apply:** the lock wrapper must be OUTERMOST so `run-with-timeout.mjs` budget timers start only after the lock is acquired. When registering a new heavy validation command, wrap it the same way; leave cheap ones (audit) unwrapped. `VALIDATION_LOCK_TIMEOUT_MS` overrides the 3 h queue-wait timeout. Steps queue and can wait many minutes — that wait is normal, not a hang ("queued, waiting…" log line).

**Nested-lock deadlock (fixed July 2026):** test-heavy (validation-lock-wrapped) internally runs `pnpm run test:e2e`, whose npm script ALSO wraps validation-lock — the inner wrapper waited forever on the lock its ancestor held, deadlocking the whole validation run (every other step queued behind it). Fix: validation-lock.mjs is now reentrant via `VALIDATION_LOCK_HOLDER_PID` exported to children; a nested wrapper whose ancestor pid matches the recorded lock holder skips acquisition. If a validation run shows all steps "queued, waiting…" for a long time, check `cat .local/validation-serial.lock` and `ps` — a live holder whose own child is queued means this deadlock.

**Nesting hazard:** never invoke a lock-wrapped script from inside another lock-wrapped command. `test-heavy-serial.mjs` once called `pnpm run test:e2e` (itself lock-wrapped) while test-heavy held the lock — the inner wrapper queued behind its own parent and self-deadlocked until the 3 h timeout. Inner steps of a serial runner must use the unwrapped variants (e.g. `test:e2e:run`).
