---
name: Serialized heavy test suites
description: Why test-unit/test-e2e-palette/test-e2e run as one serialized test-heavy validation command
---
Running the heavy suites (unit, palette e2e, full e2e) as parallel validation workflows overloads the 2-CPU machine: budgets breach with zero test failures.
**Why:** solo runs pass; parallel runs blew the 900 s unit and 3600 s e2e budgets purely from CPU contention.
**How to apply:** the `test-heavy` validation workflow runs `node scripts/test-heavy-serial.mjs` which runs all three suites sequentially (no fail-fast, combined exit code). Never re-split them into parallel validation workflows. Timeout-guard breach reports now include a load-context snapshot (loadavg + other test-runner processes) with a "BREACH UNDER LOAD" vs "NO CONCURRENT LOAD" verdict — trust that verdict before hunting for hangs.
