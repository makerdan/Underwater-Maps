---
name: Validation-lock suite aggregation
description: The scripts lock tests can hang only inside the aggregated unit command while passing repeatedly in isolation.
---

`scripts/src/validation-lock.test.mjs` may exceed the aggregate scripts-unit timeout when it runs alongside the full scripts test command, even though isolated retries complete normally.

**Why:** The aggregate runner combines lock-owning subprocess tests with many unrelated scripts tests, producing a pending-promise timeout that does not reproduce in the lock test alone.

**How to apply:** If standard validation reports this exact scripts-only timeout, first run the exact lock test in isolation three times. Do not change application code or raise timeout budgets unless the isolated test also fails consistently.