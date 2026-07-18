---
name: Validation serialization lock
description: How concurrent validation steps are serialized to prevent load-induced budget breaches
---
Heavy validation commands (typecheck, lint, test-unit, test-settings-validation, test-e2e-palette) and the root `test:e2e` script are wrapped in `node scripts/validation-lock.mjs -- <cmd>`, a global exclusive lock at `.local/validation-serial.lock` with dead-pid stale reclaim.

**Why:** the validation harness runs steps concurrently on one machine; run budgets in `tests/timeout-guard/budgets.json` are calibrated for an idle machine, so parallel suites breached budgets (e.g. test-unit 900 s) with all tests passing. Serialization also removes the codegen api.ts regeneration race and e2e port contention.

**How to apply:** the lock wrapper must be OUTERMOST so `run-with-timeout.mjs` budget timers start only after the lock is acquired. When registering a new heavy validation command, wrap it the same way; leave cheap ones (audit) unwrapped. `VALIDATION_LOCK_TIMEOUT_MS` overrides the 3 h queue-wait timeout. Steps queue and can wait many minutes — that wait is normal, not a hang ("queued, waiting…" log line).
