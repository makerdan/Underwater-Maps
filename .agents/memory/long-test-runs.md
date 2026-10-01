---
name: Running long test suites
description: How to run test suites that exceed the 2-minute shell timeout in this workspace
---

Bathyscan unit suite takes ~7.5 min wall-clock; api-server unit ~2.5 min. Hosted foreground shell calls cap at five minutes, so a full `test-heavy` run can be terminated before its 50-minute tier budget expires.

**Why:** A plan-locked heavy run was cut off by the shell limit while the full browser suite was active; the remaining processes and locks had to be reconciled, and the run could not count as complete evidence.

**How to apply:** Use the registered validation-run mechanism for long tiers, not foreground or background shell launches. `startValidationRun` accepts registered command IDs, not per-run environment values. Injecting `TASK_PLAN_FILE` through `setValidationCommand` can mutate `.replit` and the Project run button; do not upsert solely for task binding unless a validated restoration path is available and the run-button guard is checked before and after. If that path is unavailable, stop rather than launch an unlocked or incompletely bound tier. A tool-level timeout is incomplete, not a test result; confirm no runner remains and use the stale-lock cleaner before any separately authorized retry.
