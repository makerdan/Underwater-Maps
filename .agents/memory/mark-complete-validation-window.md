---
name: mark_task_complete validation window vs long suites
description: The completion workflow polls validation for only ~10.5 min; the full registered suite takes 45+ min serialized, so repeated mark calls self-DOS the lock queue.
---

Rule: with all 9 validation commands registered (incl. test-heavy), a `mark_task_complete` call can never see the suite finish — the completion workflow gives up after ~10.5 min with `validation_status: RUNNING`, while the spawned validation processes keep running in the background.

**Why:** each retry of `mark_task_complete` spawns a *new* full validation run that queues on the global validation lock behind the orphaned waiters of the previous run — three stacked runs were observed, plus a heavy-tier false budget breach because standard and heavy unit suites ran concurrently on 2 CPUs.

**How to apply:**
1. Call `mark_task_complete` once; when it returns RUNNING, do NOT immediately call again.
2. Kill orphaned lock-waiter process groups from earlier runs (`ps -eo pid,pgid,etime,args | grep validation-lock`), keep only the newest run, and remove stale `.local/validation-lock-*.lock` if no holders remain.
3. Let the newest run finish in the background (poll `ps` for `run-tier.mjs` / `validation-lock.mjs`), verify each step's log tail in `.local/state/workflow-logs/<runId>/validation.shell.exec.N`.
4. Then finalize with `skip_validation_reason` citing the run id and per-step evidence. A heavy-tier `exit 124` with a "LIKELY BUDGET BREACH UNDER LOAD" verdict while the same tests pass in the standard tier is the known false breach, not a code failure.
