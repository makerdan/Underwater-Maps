---
name: Focused Playwright runs
description: Ensures spec and grep filters actually reach Playwright through the E2E wrappers.
---

For a focused or repeated Playwright run, invoke Playwright directly under the timeout wrapper and first sweep E2E ports. When filter forwarding is uncertain, use Playwright's `--list` mode to confirm the selected tests before running them. In this workspace, forwarding filters through nested `pnpm run test:e2e` / `test:e2e:run` scripts unexpectedly ran the broader spec set.

**Why:** A broad run can take minutes and may surface unrelated flakes while giving the impression that only one case was checked.

**How to apply:** Use the standard timeout wrapper around `pnpm exec playwright test <spec> --grep=<pattern>` after `node scripts/kill-port-holders.mjs --e2e`; keep this limited to focused E2E reproduction, not the registered task validation tier.