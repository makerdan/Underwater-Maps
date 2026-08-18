---
name: Validation command editor outage
description: What to do when setValidationCommand fails with a toml-editor error for every add and update.
---

# Validation command editor outage

**Rule:** when `setValidationCommand` returns `success: false` with a
toml-editor parsing error, probe with a no-op round-trip update of an
existing command. If that also fails, the editor is down environment-wide —
nothing is wrong with your command string. Stop rewriting it and run the
already-registered validation commands verbatim via `startValidationRun`.

**Why:** an editor outage once blocked the split-tier plan (upserting
task-scoped commands); running the registered tier command as-is completed
well inside the validation-run window. Time was nearly wasted on splitting
that measurement showed was unnecessary.

**How to apply:** before splitting a tier out of fear of the run window,
measure one real run of the registered command first — tier duration
estimates in code comments tend to be stale and pessimistic.
