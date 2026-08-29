---
name: Multi-result save test mocks
description: Keep multi-card save integration fixtures cardinality-safe and model query refreshes after each successful mutation.
---

When a single-result UI test is expanded to cover neighboring results, wait
assertions must accept multiple cards, and the refetch mock must publish each
successful save back into the mocked query data.

**Why:** A helper that waits with a singular query can fail only after the
multi-result fixture is introduced, while a no-op refetch mock makes successful
saves appear broken even though the mutation resolved.

**How to apply:** Make result-presence waits cardinality-agnostic and track
successful mutation IDs in the refetch mock whenever the component derives
saved state from refreshed query data.