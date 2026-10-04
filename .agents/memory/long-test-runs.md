---
name: Running long test suites
description: How to run test suites that exceed the 2-minute shell timeout in this workspace
---

Bathyscan unit suite takes several minutes; api-server unit also exceeds a quick shell call. Hosted foreground shell calls cap at five minutes, so a long tier can be terminated before its own budget expires.

**Rule:** For assigned task tiers, use the plan-bound launcher `pnpm task:validate -- <plan-file>`; if it exceeds the foreground shell limit, run that same command in a monitored background shell. Bare registered callbacks may omit the plan context. For ordinary ad-hoc validation, use the registered validation workflow.

**Why:** A plan-locked run must preserve its task context, while the hosted validation callback accepts command IDs but no per-run environment. A repository-owned launcher can bind the plan without rewriting the shared run command.

**How to apply:** Confirm the launcher dry-run selects the authorized tier, then preserve the exact plan-bound command in the background and monitor it when needed. Never inject `TASK_PLAN_FILE` by upserting `.replit`, strip the lock, or infer a passing result from timeout. Before an authorized retry, confirm the original runner ended and use the stale-lock cleaner if needed.

## Flaky failure attribution

**Rule:** If a test fails in an assigned full tier but passes when run alone, that proves only run-context sensitivity; it does not establish that the failure was pre-existing. Preserve both results and require the same authorized tier to pass, or report the unresolved failure.

**Why:** A focused run removes full-suite scheduling, setup order, and resource pressure, so its success cannot establish what the original run's provenance was.

**How to apply:** For an unrelated failure, run the failing file alone once as triage. If the task allows another attempt, rerun only the same assigned tier; do not classify the failure as baseline solely because the focused run passes.
