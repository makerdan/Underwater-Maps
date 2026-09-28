---
name: Validation upserts can mutate Project
description: Why temporary task-locked validation command changes can alter .replit beyond the requested validation command.
---

`setValidationCommand` may reorder workflow metadata and may also reattach the
validation workflow to the `Project` run button, switching `Project` to parallel
mode even when only one validation command was upserted.
Restoring the validation command after a run does not undo the run-button
mutation; the active tier can fail its run-button guard before it reaches
later steps.

**Why:** Temporary task-locked validation upserts have produced both harmless
metadata-table ordering drift and a material run-button regression that caused
environment startup to launch validation automatically.

**How to apply:** Do not temporarily upsert a registered validation command just
to inject `TASK_PLAN_FILE`; prefer `scripts/run-locked-tier.mjs`. Clearing a
temporary validation command can remove its workflow while leaving `Project`
in parallel mode. After any necessary registration, run the no-op guard and
inspect `.replit`. Restore the intended complete file through
`verifyAndReplaceDotReplit`; never edit `.replit` directly. The helper requires
`tempFilePath` to be an absolute workspace path; a relative candidate path is
rejected.
