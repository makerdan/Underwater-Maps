---
name: Validation workflow boot storm
description: Environment restart autostarts every configured validation workflow at once; they queue on the global lock and orphaned boot holders can block your tier run.
---

# Validation workflow boot storm

**Status (2026-08-18): root cause FIXED.** The storm was caused by the "Project" run-button workflow listing every validation workflow as a parallel `workflow.run` task; it fired on every environment restart. The Project workflow is now a single no-op `echo` and stale task-specific workflows were deleted. If the storm recurs, check whether `workflow.run` tasks crept back into the run-button workflow in `.replit` (edit via temp file + `verifyAndReplaceDotReplit`, direct edits are blocked).

**Rule (if it recurs):** After an environment restart, autostarted validation workflows all queue on the `global` validation lock. Before running your own tier: `stopWorkflow` each extraneous validation workflow, then check `ps` for orphaned boot-time holders (detached pgids from ~boot time still holding `global`/`unit-cpu` locks) and kill their pgids. `stopWorkflow` alone does NOT reliably kill the detached process groups.

**Why:** A boot storm serialized hours of unneeded runs behind one lock and an orphaned boot tree kept holding `global` even after its workflows were "stopped", deadlocking the intended tier run.

**How to apply:** When a tier run sits at "another validation step holds the lock" for minutes, list workflows + `ps aux | grep -E "validation-lock|run-tier"`; stop extras, kill orphan pgids, re-check lock files in `.local/`.

## Related: test:unit fail-fast hides artifact suites

`test:unit` is a pnpm recursive run with fail-fast. A failure in an early package (e.g. `scripts`) aborts the step before the bathyscan / api-server suites ever run. If the blocker is a pre-existing failure owned by another in-flight task, validate your own diff with a targeted `npx vitest run <touched test files>` inside the artifact package and document the skip — do not conclude the artifact suites passed just because the step log shows green packages.
