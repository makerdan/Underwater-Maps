---
name: Task-locked scripts suite interaction
description: A scripts unit aggregation can expose an inherited task-plan environment interaction that isolated checks do not reproduce.
---

The check-failure-gate self-test can pass repeatedly in isolation while the broader scripts unit aggregation reports a failure when `TASK_PLAN_FILE` is inherited by the task-locked validation process. Treat isolated green retries plus an unchanged test file as evidence of a pre-existing suite interaction, not as a reason to alter the skip-count task.

**Why:** Task validation must set `TASK_PLAN_FILE` for tier locking, while some subprocess-oriented self-tests exercise the no-plan path; aggregation can expose their environment coupling.

**How to apply:** When standard validation stops in this self-test, inspect the exact failure, retry the file three times with the task variable, and compare with an ad-hoc run without it before changing code.