---
name: Validation command editor outage
description: What to do when setValidationCommand fails with a toml-editor error for every add and update.
---

# Validation command editor outage

**Rule:** when `setValidationCommand` returns `success: false` with a
toml-editor parsing error, probe with a no-op round-trip update of an
existing command. If that also fails, the editor is down environment-wide —
nothing is wrong with your command string. Stop rewriting it and run the
already-registered validation commands verbatim via `startValidationRun`. If
the registry is empty, run the canonical command directly with
`TASK_PLAN_FILE` set to the active plan.

**Why:** an editor outage once blocked the split-tier plan (upserting
task-scoped commands); running the registered tier command as-is completed
well inside the validation-run window. A later outage left no registered
commands, but the repository's canonical command still passed with the plan
lock when run directly. Time was nearly wasted on splitting that measurement
showed was unnecessary.

**How to apply:** before splitting a tier out of fear of the run window,
measure one real run of the registered command first — tier duration
estimates in code comments tend to be stale and pessimistic. If no command is
registered, use the command in `scripts/register-validation-commands.mjs`
directly and export `TASK_PLAN_FILE` for task-driven validation.
