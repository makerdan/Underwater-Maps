---
name: Managed validation task environment
description: Managed validation workflows do not inherit task-agent environment variables
---
Managed validation workflows may execute a registered tier without inheriting `TASK_PLAN_FILE`, even when the task agent has set it.

**Why:** the managed workflow condition falls back to `--allow-no-plan`, so its run does not exercise the task tier-lock precheck.

**How to apply:** treat managed workflow results as coverage only; when task-lock evidence is required, run the resolved tier directly with `TASK_PLAN_FILE` set and avoid starting a heavier tier.