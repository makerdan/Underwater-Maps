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
- `tests/e2e/overview-puzzle-multiselect.spec.ts` — 2/6 tests still fail deterministically after the toSatisfy fixes, verified on a pristine main checkout (sessionStorage-hydration reload test; Reset-button test, a spec/app mismatch — Reset renders only when a tile has a nonzero transform, but the test creates only a group).
- Durable rule: tests that scrub the tide slider to a hard-coded hour fail during that wall-clock UTC hour (setHour short-circuits when the target hour equals "now"). Always derive the target hour from the current hour plus an offset.
- Plan-archive lint gates block every tier per environment — see plan-file-lint-backlog.md.
- Raw `pnpm audit --audit-level=moderate` — 6 dev-only vulns (5 moderate + 1 exempted high via jsdom→undici; 1 postcss). Registered check:audit gate is green.

**How to apply:** don't cite the resolved items as pre-existing failures in new plans; a red in one of them is a NEW regression. Skip-reason completions citing this baseline should reference only the still-live items.

Update 2026-08-17 (later): new pre-existing baseline breakage from mobile-task merges, verified on clean HEAD:
- typecheck: bathyscan src/App.tsx TS2322 — `planContent` prop not on MobileChartShell
- unit: appTsxDuplicateHooks.test.ts corrupted (undefined absPath/relPath, duplicated test bodies — concurrent-merge damage; 7 failures) + MobileChrome.test.tsx 3 gear-button failures
- lint: no-duplicate-imports in App.tsx and useMobileChartOverlays.ts; no-unused-vars in the corrupted test file
- check:failure-gate-self-test fails on branches predating the #4090-era fix; check:regression-guard self-test has the same TASK_PLAN_FILE env-leak (fix still pending) — same-tier --skip both.

## 2026-08-17 (later) — resolved same day
A mobile-chart merge wave briefly broke repo-wide typecheck/lint (truncated test file) plus the settings sentinel and terrain-mock guard; all repaired on main the same day. Durable lesson: mid-session foreign merges can break AND repair the shared tree while a task runs — re-verify any "baseline" failure at current HEAD before skipping steps or citing it, and re-check again before task completion; the set changes hourly on busy days.

## 2026-08-18 — github.test.ts admin-gate order-dependent failure
`artifacts/api-server/src/routes/__tests__/github.test.ts` (Admin gate → 403 tests)
fails under the sharded run (`vitest run --shard=2/2`: 8 tests get 500 instead of
403) but passes solo (74/74). Test-order/isolation issue — likely env-stub or
mock leakage from an earlier file in the shard, introduced with the admin-gate
commits (`2642def7`/`b54085ae`/`f3760f55`), not by concurrent frontend work.
Triage rule: run the file solo before blaming your diff; if solo-green, treat as
baseline breakage.


## 2026-08-18 — OverviewMap pointercancel order-dependent failure
`OverviewMap.pointercancel.test.tsx` fails under the full bathyscan unit run
(1/5667) but passes 3/3 solo. Same class as the github.test.ts entry above:
order/load-dependent, observed right after the puzzle-layout merge wave —
solo-verify before blaming an unrelated diff.
