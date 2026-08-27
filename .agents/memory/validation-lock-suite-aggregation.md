---
name: Validation-lock suite aggregation
description: The scripts lock tests can hang only inside the aggregated unit command while passing repeatedly in isolation.
---

The scripts unit aggregate must run Node test files serially because `scripts/src/validation-lock.test.mjs` owns many short-lived lock subprocesses; parallel file workers can leave the aggregate waiting on a pending child promise even when isolated retries complete normally.

**Why:** The aggregate runner combines lock-owning subprocess tests with many unrelated scripts tests; serial file execution removes the overlap that can strand a child completion promise without changing the lock behavior or isolated test command.

**How to apply:** Keep the scripts workspace `test:unit` Node invocation at `--test-concurrency=1`. Keep the standalone `test` command available for isolated lock coverage, and if standard validation reports this timeout, run the exact lock test in isolation three times before changing lock behavior or budgets.