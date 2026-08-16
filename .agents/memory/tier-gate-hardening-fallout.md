---
name: Tier-gate hardening fallout (Aug 2026)
description: Standard/full validation tiers fail on plan-file quality gates unrelated to most tasks; how to get a meaningful run
---

# Tier-gate hardening fallout (Aug 2026)

As of 2026-08-16, the tier-lock/failure-gate hardening left several validation
steps red for every task, regardless of what the task touched (a dedicated
gate-repair task exists — check the task list before re-fixing):

- `check:failure-gate` (strict) — ~900 archived `.local/tasks` plan files carry
  unfilled `**Why:**` placeholder stubs that `--fix-stub` cannot repair.
- `check:regression-guard` / `fix:regression-guard-stubs` — plan files from other
  in-progress tasks with partially-filled Regression Guard sections exit 1 even in
  fix-stub mode.
- `scripts/__tests__/run-tier-check.test.mjs` — two "graceful degradation exits 0"
  tests went stale when missing `## Validation` became a hard exit-1; fixed
  2026-08-16 to assert the TIER-LOCK VIOLATION behavior.

**How to apply:** To get a meaningful tier run while gates are red, temporarily
upsert the registered tier command with `--skip <step>` for the broken gates only
(plus `TASK_PLAN_FILE=<plan>` prefix — run-tier hard-errors without it), run, then
restore the original command. Classify gate failures via the Failure Gate 2-of-3
evidence rule; never fix hundreds of archived plans inside an unrelated task.

Also: `run-tier.mjs` now exits 1 without `TASK_PLAN_FILE` set (no warn-and-continue),
and the plan's `## Validation` section must use the exact `**Command:** \`tier\``
format or the tier-lock pre-check can't parse it.
