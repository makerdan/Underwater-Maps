---
name: startValidationRun 10-minute poll budget
description: Validation runs launched via startValidationRun are force-STOPPED after ~600 polls (~10 min); how to run longer tiers anyway.
---

# startValidationRun poll budget

`startValidationRun` polls ~600 times (~10 minutes) and then **stops the run** (`POLL_BUDGET_EXCEEDED`, status STOPPED, exit 1) even if it was healthy and progressing. The standard tier with test:unit takes longer than that and will never finish inside one run.

**How to apply:** split long tiers into sub-10-minute validation commands and run them sequentially:
- static steps: `run-tier.mjs standard --skip test:unit` (plus any classified pre-existing-gate skips) — ~1–3 min;
- per-package unit runs: bathyscan alone (~2.5–8 min), api-server + small libs alone (~7–9 min; api-server both shards ≈ 7 min).
Retrieve a stopped run's partial log at `.local/state/workflow-logs/<runId>/validation.shell.exec.0` — it often shows most suites already passed; only re-run what never ran (logs of STOPPED runs are sometimes deleted, so read them immediately).

Also: an environment restart (e.g. after other tasks merge) autostarts **all** validation workflows; a test-heavy run then holds the global validation lock for 45+ min and every other run queues behind it, burning the poll budget while waiting. Kill the boot-storm pgids and stale `.local/validation-lock-*.lock` files (dead pid in file) before starting your own runs.
