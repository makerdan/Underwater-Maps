---
name: Managed validation task environment
description: Managed validation workflows do not inherit task-agent environment variables
---
Managed validation workflows may execute a registered tier without inheriting `TASK_PLAN_FILE`, even when the task agent has set it. The tier runner then fails closed with a TIER-LOCK VIOLATION before running any checks.

**Why:** completion validation launches registered commands in a separate environment from the task agent. A missing task-plan variable is a setup failure, not a test failure or evidence of a regression.

**How to apply:** when task-lock evidence is required, run exactly the plan's resolved tier directly with `TASK_PLAN_FILE` set and avoid starting a heavier tier. If every managed completion command fails this way, cite the logs and the direct tier run when using a validation-skip reason; do not weaken the tier lock or alter shared workflows for one task.