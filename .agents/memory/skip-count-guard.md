---
name: Skip-count ratchet guard
description: How the skip-count validation guard works and when to touch its baseline
---
Rule: never add `it.skip`/`test.skip`/`describe.skip` to unit tests (baseline is 0 — rewrite or delete instead; use `.skipIf(condition)` for legitimate gates so tests self-re-enable). New e2e `test.skip(` gates require a message, a matching category in tests/e2e/SKIP-AUDIT.md, and a baseline bump in tests/skip-baseline.json in the same commit.

**Why:**Seven unit tests sat permanently skipped for months after the preset datasets they depended on were retired, and e2e conditional skips grew unnoticed; nothing alerted on skip growth.

**How to apply:** `pnpm run check:skip-count` (scripts/check-skip-count.mjs) runs in the fast validation tier and fails when either count rises above baseline; it prints a ratchet-down note when counts drop.
