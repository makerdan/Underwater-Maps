---
name: Tier-lock TASK_PLAN_FILE requirement
description: Every tier validation run now requires TASK_PLAN_FILE pointing at a compliant plan file; how to make a plan pass the tier-lock, failure-gate, and regression-guard checks.
---

# Tier runs require TASK_PLAN_FILE + compliant plan sections

`scripts/run-tier.mjs` refuses to run unless `TASK_PLAN_FILE=<plan.md>` is set (or `--allow-no-plan` for ad-hoc runs). The plan must contain:
- `## Validation` with a backticked `**Command:**` (one of test-fast/test-standard/test-standard-plus/test-heavy), a filled `**Why:**`, and `**Do not escalate:**`.
- `## Regression Guard` that is `**Self-satisfying**`, `**N/A** + **Why N/A:**`, or all three of `**Covers:** / **Test location:** / **What it checks:**` with real content.
- `## Pre-existing failures to ignore`.

**Why:** guards merged mid-Aug 2026 (tier-lock + failure-gate + regression-guard) hard-fail any run whose plan is missing/non-compliant; the registered tier workflows do NOT set the env var, so bare workflow restarts always fail with TIER-LOCK VIOLATION.

**How to apply:** run `node scripts/check-failure-gate.mjs --fix-stub <plan>` to insert stubs, then hand-fill `**Why:**` and Regression Guard fields. Execute the tier by upserting the registered validation command with a `TASK_PLAN_FILE=... ` prefix (setValidationCommand + startValidationRun), and RESTORE the original command string afterwards. The `fix:*` steps auto-patch missing sections in ALL `.local/tasks` plans but exit 1 if any file still has unfilled fields — including yours.
