---
name: Tier-gate baseline triage rules
description: Durable rules for classifying standard/heavy tier failures as pre-existing baseline vs. new breakage, and gate policies that must not regress.
---

# Tier-gate baseline triage rules

## Gate policies (durable — do not regress)
- Missing `## Validation` section in a task plan is an intentional hard TIER-LOCK VIOLATION (exit 1); the run-tier meta-tests assert this. Legacy `.local/tasks` plans are grandfathered with compliant backfilled sections plus a "Grandfathered legacy plan" **Why:** line — never reintroduce "Placeholder — review before running this task" wording.
- Registered tier validation commands are task-agnostic: `test-standard` honors a caller-provided `TASK_PLAN_FILE` and falls back to `--allow-no-plan`; other tiers run `--allow-no-plan`. Never hard-code a specific task's plan file into a shared workflow — `env VAR=` overrides callers and tier-locks every future task against a stale plan.
- Fire-and-forget lifecycle calls (e.g. bucket-job rehydration) must build conditions inside try and carry a defensive `.catch`, or a mocked/broken schema trips the vitest unhandled-error gate on otherwise green runs.

## Triage rules
- When typecheck or a unit file aborts the tier on a file your diff never touched, `git log` the offending file for another task's merge before debugging; use the skip-variant commands and run tail steps manually.
- If a @workspace/db-mock-shaped suite regresses, check (a) NODE_ENV set to "test", (b) new @workspace/db exports missing from `createDbMock` (its guard test fails first with a clear message).
- Known recurring flags: `check:fixture-freshness` on survey.laz (laz-fixture-nondeterminism.md) and `pnpm audit` HIGH findings — verify against current output before treating as baseline.

As of 2026-08-16 the standard tier passes end-to-end with no skips; any tier failure after that date is NEW breakage unless matched by a rule above.
