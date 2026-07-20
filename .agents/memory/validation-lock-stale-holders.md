---
name: Stale validation-lock holders after aborted validation runs
description: Aborted mark_task_complete validation runs leave orphaned validation-lock.mjs processes queued on the global lock, deadlocking later runs.
---

When a platform validation run is aborted mid-flight (e.g. it exceeds its window while nine serialized commands queue on the global lock), the spawned `scripts/validation-lock.mjs` wrapper processes are NOT killed. They keep holding/queuing the `.local/validation-lock-global.lock` for hours (default lock timeout is 3 h), so every subsequent validation run or manually started tier workflow just prints "another validation step holds the lock … waiting" forever.

**How to fix:** `ps -eo pid,lstart,args | grep validation-lock.mjs`, kill the process groups of every holder that belongs to a dead/aborted run (`kill -9 -- -<pgid>`), remove leftover `.local/validation-lock-*.lock` files, then restart the tier workflow you actually need.

**Why:** the lock's dead-PID reclaim only fires when the holder PID is gone; orphaned wrappers stay alive because only their Temporal parent died.

**Also:** the full registered validation set (typecheck, lint, 3 tiers, 2 e2e suites, …) cannot finish inside a mark_task_complete window when serialized — expect RUNNING/timeouts; verify with the task's designated tier workflow instead and skip validation with a reason.
