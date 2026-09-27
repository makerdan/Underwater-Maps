---
name: Validation workflow boot storm
description: Environment restart autostarts every configured validation workflow at once; they queue on the global lock and orphaned boot holders can block your tier run.
---

# Validation workflow boot storm

**Rule:** Keep the "Project" run-button workflow to one sequential `shell.exec` no-op. A `workflow.run` task can launch validation on startup, and parallel tasks can queue unnecessary runs on the global lock.

**Why:** A previous boot storm and orphaned process group blocked intended validation for hours; stopping a workflow alone did not reliably stop its detached process.

**How to apply:** Run `node scripts/check-runbutton-noop.mjs` before and after changing validation registrations. Treat an existing violation as unrelated unless the current task caused it. If the tier waits on a lock, inspect workflows, `ps aux | grep -E "validation-lock|run-tier"`, and lock files under `.local/`; stop extras and clear confirmed orphan process groups. Repair `.replit` only when in scope, through validated replacement, never direct editing.

## Related: test:unit fail-fast hides artifact suites

`test:unit` is a pnpm recursive run with fail-fast. A failure in an early package (e.g. `scripts`) aborts the step before the bathyscan / api-server suites ever run. If the blocker is a pre-existing failure owned by another in-flight task, validate your own diff with a targeted `npx vitest run <touched test files>` inside the artifact package and document the skip — do not conclude the artifact suites passed just because the step log shows green packages.
