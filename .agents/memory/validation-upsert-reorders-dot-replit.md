---
name: Validation upserts can mutate Project
description: Why temporary task-locked validation command changes can alter .replit beyond the requested validation command.
---

Both `setValidationCommand` and `configureWorkflow` may reorder workflow
metadata or reattach the validation workflow to the `Project` run button,
switching `Project` to parallel mode even when only one validation command was
upserted and automatic startup was disabled. Restoring the command does not undo
the run-button mutation; the active tier can fail its run-button guard before
reaching later steps.

**Why:** Temporary task-locked validation upserts have produced both harmless
metadata-table ordering drift and a material run-button regression that caused
environment startup to launch validation automatically. Adding a temporary
console workflow can independently fail the project's exact registered-
workflow-list guard, even after the run button is corrected.

**How to apply:** Do not temporarily upsert a registered validation command just
to inject `TASK_PLAN_FILE`; prefer `scripts/run-locked-tier.mjs`. Clearing a
temporary validation command can remove its workflow while leaving `Project`
in parallel mode. Do not add an extra bootstrap workflow merely to avoid a
shell time limit; the exact registered workflow list is tested. Preserve the
existing slots and verify both the no-op run button and workflow-list contract
before launching. If temporary wiring is unavoidable, use a gated command in
an existing slot, capture the actual process arguments at workflow start, and
restore the canonical configuration before release; metadata alone does not
prove what command started.

Never edit `.replit` directly. Build the complete candidate from the saved
pre-upsert file, normalize it to LF, write it to an absolute workspace path,
and compare `.replit` byte-for-byte after replacement. Use
`verifyAndReplaceDotReplit({ tempFilePath })`; the helper rejects relative
paths and consumes the candidate file, so retain the canonical comparison
bytes separately.
