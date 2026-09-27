---
name: Task-tier lock in validation runs
description: Supplying task plan context when starting a registered validation run.
---

**Rule:** A registered validation run does not automatically receive the assigned task's `TASK_PLAN_FILE`. Supply the plan path in the command environment for task-driven tiers, and restore the registered command after the run starts.

**Why:** Without the plan variable, the runner correctly fails closed before validation, even when the requested tier matches the task plan.

**How to apply:** Read the original registered command, temporarily prefix it with `TASK_PLAN_FILE=<plan path>`, start only the plan-authorized validation, then restore the original command. Never bypass the lock for assigned tasks.

**Completion check caveat:** The completion callback may launch every configured tier without forwarding `TASK_PLAN_FILE`; those runs then fail immediately at the lock instead of validating code. Do not attach the task plan to higher tiers when the plan forbids escalation.

**Why:** A task plan's validation ceiling must remain authoritative even when the completion runner is broader than the assigned tier.

**How to apply:** Run the assigned tier with the plan path explicitly supplied, preserve its result, and report the completion-runner lock mismatch rather than launching unauthorized tiers.