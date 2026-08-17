---
name: Aug-2026 baseline failures — mostly resolved
description: Status of the 2026-08 documented baseline failures after the 2026-08-17 bug audit; only the puzzle e2e toSatisfy failure and the plan-archive lint gates remain live.
---

# Aug-2026 baseline failures — audit-verified status (2026-08-17)

Full detail in `docs/audits/bug-audit-preexisting-2026-08.md`.

**RESOLVED (all fixed 2026-08-16, verified green on a clean tree):**
- ThrottlePanel unit-sync test — test-isolation fix (seed driveBoatStore in renderWithState, reset in beforeEach). 3/3 solo passes.
- api-server routes-documented.test.ts — trails soft-delete route documented in openapi.yaml.
- check:audit 5 unexempted highs — dep bumps + documented undici exception (GHSA-4cwx-7wf7-3272, fixDate 2026-10-17).
- check:fixture-freshness survey.laz — .laz now compared size-only (lazrs bytes are environment-dependent).

**STILL LIVE:**
- `tests/e2e/overview-puzzle-multiselect.spec.ts` — 3/6 tests fail deterministically: `expect.poll(...).toSatisfy is not a function` (Vitest matcher, unsupported by Playwright expect.poll; 5 call sites). The documented "60 s timeout" did NOT reproduce solo — load artifact of the full palette suite.
- Plan-archive lint gates block every tier per environment — see plan-file-lint-backlog.md.
- Raw `pnpm audit --audit-level=moderate` — 6 dev-only vulns (5 moderate + 1 exempted high via jsdom→undici; 1 postcss). Registered check:audit gate is green.

**How to apply:** don't cite the resolved items as pre-existing failures in new plans; a red in one of them is a NEW regression. Skip-reason completions citing this baseline should reference only the still-live items.
