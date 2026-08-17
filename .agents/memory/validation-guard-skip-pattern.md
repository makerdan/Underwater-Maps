---
name: Validation guard --skip-if-no-task pattern
description: How check-failure-gate.mjs and check-regression-guard.mjs handle ad-hoc vs task-scoped runs to avoid circular archive-stub failures.
---

## The rule
Both `check-failure-gate.mjs` and `check-regression-guard.mjs` support a `--skip-if-no-task` flag. When passed, they exit 0 immediately if `TASK_PLAN_FILE` is not set.

The fast-tier validation steps in `scripts/validation-steps.mjs` pass this flag:
```
fix:failure-gate-stubs    →  check-failure-gate.mjs --fix-stub --skip-if-no-task
check:failure-gate        →  check-failure-gate.mjs --skip-if-no-task
fix:regression-guard-stubs → check-regression-guard.mjs --fix-stub --skip-if-no-task
check:regression-guard    →  check-regression-guard.mjs --stubs-only --skip-if-no-task
```

**Why:** Without this flag, `fix:*-stubs` patches 900+ gitignored archive files with unfilled placeholder stubs, then `check:*` immediately flags those same placeholders as violations. The circular failure makes test-fast permanently red in fresh environments.

**How to apply:** Any new validation guard script that scans `.local/tasks/` in full-archive mode should support `--skip-if-no-task` for the same reason. The self-tests (which run without TASK_PLAN_FILE) must NOT pass this flag — they test the archive-scan behavior directly.

Task-agent runs (where TASK_PLAN_FILE is always set) are unaffected — they use single-file mode regardless of this flag.
