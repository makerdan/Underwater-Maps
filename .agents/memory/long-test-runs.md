---
name: Running long test suites
description: How to run test suites that exceed the 2-minute shell timeout in this workspace
---

Bathyscan unit suite takes ~7.5 min wall-clock; api-server unit ~2.5 min. Detached/background bash jobs get killed between tool calls, and direct shell runs cap at 120 s.

**How to apply:** For a long single-package run, temporarily narrow the root `test:unit` script to that package, `restart_workflow "test-unit"` with a long timeout, read `/tmp/logs/test-unit_*.log`, then restore the script. Timeout budgets live in `tests/timeout-guard/budgets.json` (single source of truth for all suites).

**Why:** measured while sizing timeout-guard budgets; guessing budgets from partial runs led to too-tight values.
