---
name: Task-tier lock in validation runs
description: Supplying task plan context when starting a registered validation run.
---

**Rule:** Before the v4 ordinary-task cutover, this project explicitly preserves `pnpm task:validate -- <plan-file>` as its sole ordinary-task route. Dry-run it to confirm the plan's single tier, then run only that tier. This legacy route is not a v4 local-ID activation or v4 evidence.

**Why:** The project Failure Gate README says v4 activation remains blocked pending its separate pinned installation approval and verified cutover; the prior plan-file route remains authoritative for ordinary tasks meanwhile.

**How to apply:** Run `pnpm task:validate --dry-run -- <plan-file>`, then `pnpm task:validate -- <plan-file>`. Never use `--allow-no-plan`, run another tier, or mutate a shared validation command to add task context. Do not invoke the v4 bridge for ordinary work until its approved cutover. A bare completion callback may omit `TASK_PLAN_FILE` and fail at the tier lock; preserve the plan-bound run's actual result and do not attach the plan to higher tiers.

**Completion check caveat:** The completion callback may launch every configured tier without forwarding `TASK_PLAN_FILE`; those runs then fail immediately at the lock instead of validating code. Do not attach the task plan to higher tiers when the plan forbids escalation.

**Why:** A task plan's validation ceiling must remain authoritative even when the completion runner is broader than the assigned tier.

**How to apply:** Use the plan-bound launcher for the assigned tier, preserve its actual outcome, and report the completion-runner lock mismatch rather than launching unauthorized tiers.