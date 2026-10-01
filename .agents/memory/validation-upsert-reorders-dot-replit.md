---
name: Validation upserts can mutate Project
description: Why temporary task-locked validation command changes can alter .replit beyond the requested validation command.
---

Both `setValidationCommand` and `configureWorkflow` may reorder workflow metadata and reattach the
validation workflow to the `Project` run button, switching `Project` to parallel
mode even when only one command was registered and automatic startup was disabled.
Restoring the validation command after a run does not undo the run-button
mutation; the active tier can fail its run-button guard before it reaches
later steps.

**Why:** Temporary task-locked validation upserts have produced both harmless
metadata-table ordering drift and a material run-button regression that caused
environment startup to launch validation automatically.
Adding a temporary console workflow can independently fail the project's exact
registered-workflow-list guard, even after the run button is corrected.

**How to apply:** Do not temporarily upsert a registered validation command just
to inject `TASK_PLAN_FILE`; prefer `scripts/run-locked-tier.mjs`. Clearing a
temporary validation command can remove its workflow while leaving `Project`
in parallel mode. After any necessary registration, run the no-op guard and
inspect `.replit`. Restore the intended complete file through
`verifyAndReplaceDotReplit`; never edit `.replit` directly. The helper requires
`tempFilePath` to be an absolute workspace path; a relative candidate path is
rejected.
Do not add an extra bootstrap workflow merely to avoid a shell time limit:
configuration is itself tested. Preserve the existing registered slots and
verify both the no-op run button and exact workflow-list contract before launching.
When a checked run requires temporary launch wiring, a gated command in an
existing slot can be captured at workflow start, then canonical configuration
restored before release. Check actual captured process arguments, not just the
current workflow metadata. Retain the canonical comparison bytes separately:
the validated replacement helper consumes its candidate file.
