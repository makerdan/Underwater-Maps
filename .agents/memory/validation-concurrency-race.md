---
name: Validation harness concurrency race
description: Why test-all / test:e2e validation steps fail flakily during mark_task_complete
---

The mark-task-complete validation harness runs its registered commands concurrently, but `test-all` internally re-runs `pnpm run typecheck` (which runs orval codegen) and the e2e servers bind fixed ports (3150/3161).

**Why:** Two concurrent codegen runs rewrite `lib/api-zod/src/generated/api.ts` at the same time; the band-boundaries patch script then reports "expected to patch 3 schemas but only patched 0" and exits 1. Concurrent/overlapping e2e runs fail with "http://127.0.0.1:3161/api/healthz was already in use". Failures alternate between validation runs, confirming a race rather than a real regression.

**How to apply:** When validation fails only in `test-all` (codegen patch count) or `test:e2e` (port 3161 in use), reproduce the failing step alone first — if it passes standalone, it is this race. Free ports 3150/3161 (`fuser -k`) before retrying, and if it persists, complete with a skip_validation_reason citing this file rather than iterating.
