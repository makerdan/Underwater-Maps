---
name: Workflow limit counter goes stale
description: configureWorkflow rejects with "Workflow limit exceeded (10/10)" even after removeWorkflow succeeds; retry after a delay.
---
The workflow platform enforces a 10-workflow cap. After `removeWorkflow` succeeds, `configureWorkflow` can keep failing with "Workflow limit exceeded (10/10)" and print a stale workflow list (still including the removed one) for several minutes.

**Why:** the limit check reads a cached workflow list that lags behind removals.

**How to apply:** verify actual state with `listWorkflows()` (it reflects removals immediately), then retry `configureWorkflow` after waiting a few minutes — it eventually succeeds. Don't remove more workflows in the meantime; the removal did work. E2e-suite alternative: a single-spec `npx playwright test <spec>` run that skips fast fits inside the 2-minute bash cap (server startup ~60–90 s), so a temp workflow isn't always necessary.
