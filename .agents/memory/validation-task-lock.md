---
name: Task-tier lock in validation runs
description: Keep checked task validation distinct from independent validation callers.
---

**Rule:** Task-driven tiers must use `pnpm task:validate -- <plan-file>` with the exact plan. Pending separate approved v4 cutover, this is the authorized ordinary-task route and the plan's assigned tier is the ceiling. Shared tier runners may run without a plan only for independent callers; those results are diagnostics, not task evidence. A supplied plan always enforces its tier, regardless of flags.

**Why:** The project Failure Gate README says v4 activation remains blocked pending its separate pinned installation approval and verified cutover, so the plan-file route remains authoritative for ordinary tasks. Platform final checks do not receive the assigned task plan; attaching it to higher tiers violates the task ceiling, while treating unscoped results as task evidence weakens provenance.

**How to apply:** Run `pnpm task:validate --dry-run -- <plan-file>`, then `pnpm task:validate -- <plan-file>`; run only the assigned tier. Never use `--allow-no-plan` as a task bypass, run another tier, mutate a shared validation command to add task context, or invoke the v4 bridge before its approved cutover. An unscoped shared-runner call is independent, not a plan bypass, and cannot replace checked task evidence.

**Completion check caveat:** A completion callback may launch every configured tier without forwarding `TASK_PLAN_FILE`; those runs can fail immediately at the lock instead of validating code. Preserve the assigned plan-bound result, report the mismatch, and do not attach the plan to higher tiers when the plan forbids escalation.
