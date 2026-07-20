---
name: validation-tiers
description: >-
  Tier selection guide for BathyScan validation commands. Read this to choose
  test-fast, test-standard, or test-heavy for the current task. Covers step
  contents, decision table, and escalation rules.
---

# Validation Tiers

BathyScan has three registered validation commands. Pick the **lowest** tier that still catches regressions relevant to what the task touched. Higher tiers catch more but cost 45+ minutes; use them only when the risk justifies it.

## Tier Definitions

| Command | Script | Steps | Typical duration |
|---|---|---|---|
| `test-fast` | `node scripts/run-with-timeout.mjs tierFast -- node scripts/run-tier.mjs fast` | typecheck, lint, check:lock-skill-sync, check:root-relative-api, check:deps-suppression | ~5 min |
| `test-standard` | `node scripts/run-with-timeout.mjs tierStandard -- node scripts/run-tier.mjs standard` | fast steps + test:unit, check:docs-stale, check:catalog-coverage, check:schema-stale | ~20 min |
| `test-heavy` | `node scripts/run-with-timeout.mjs aggregate -- node scripts/test-heavy-serial.mjs` | preflight (standard tier minus test:unit) + test:unit + e2e-palette + test:e2e | ~45 min |

**All steps and checks (across all tiers):**
1. `typecheck` — codegen freshness check + tsc across all packages
2. `lint` — ESLint (covers `artifacts/bathyscan/src`, `artifacts/api-server/src`, `tests/e2e`)
3. `check:lock-skill-sync` — verifies key flag names/env-vars documented in Port-Authority skill still appear in scripts/validation-lock.mjs
4. `check:root-relative-api` — forbids root-relative `/api/` fetch calls that bypass the artifact base path
5. `check:deps-suppression` — exhaustive-deps suppressions must carry a rationale
6. `test:unit` — Vitest unit suites (api-server, bathyscan, api-zod)
7. `check:docs-stale` — API route docs in README/replit.md match openapi.yaml
8. `check:catalog-coverage` — every catalog entry has a test
9. `check:schema-stale` — Drizzle schema vs migration snapshot diff
10. `check:e2e-user-ids` — no hardcoded user-ID literals in e2e specs (full tier only)
11. `check:e2e-cjs-globals` — no CJS globals in e2e files (full tier only)
12. `check:fixture-freshness` — test fixture snapshots are up to date (full tier only)
13. `check:ports` — no port collisions between services (full tier only)
14. `check:port-drift` — entry-point port wiring consistency (Vite config, API bootstrap, Playwright URLs) (full tier only)
15. `check:audit` — npm dependency vulnerability audit (full tier only)

**test-heavy structure**: runs `run-tier.mjs standard --skip test:unit` as a fail-fast preflight (steps 1–5 plus 7–9; test:unit is skipped because the heavy runner runs it itself) before launching the three serialized heavy suites (test:unit, e2e-palette, test:e2e). Heavy suites run with no-fail-fast so all three are reported in one pass. The test:unit heavy step has no per-step budget — it is covered by the outer `aggregate` budget.

## Trivial Change Fast-Track

A task qualifies as **trivial** if it is limited to:
- Copy/text changes (labels, tooltips, wording),
- Style-only changes (CSS/Tailwind classes, colors, spacing), or
- Single-component cosmetic tweaks with **no** logic, store, or API changes.

For trivial tasks:
- Run `test-fast` **only**. Do not run `test-standard` or `test-heavy`.
- **Escalation is forbidden** unless `test-fast` itself fails on code the task touched. A pre-existing failure elsewhere (see below) is never a reason to escalate.
- Do not investigate or fix unrelated red — record it as baseline breakage and finish the task.

**Plan tier is authoritative:** when a task plan or task description names a validation tier, run exactly that tier. Do not run heavier tiers on your own initiative, even if the escalation rules below would otherwise suggest one — those rules apply only when no tier was specified.

## Pre-Existing Failure Triage

If a validation step fails in files or suites the task did **not** touch:

1. Check whether the task touched the failing file or anything it imports/tests (grep the diff against the failing spec's subject).
2. If unrelated, run the failing file solo once to confirm the failure reproduces without your changes (or check memory/other tasks for known baseline breakage).
3. If it is pre-existing: record it as baseline breakage in your summary, **do not attempt to fix it**, and **do not escalate tiers because of it**. Fixing the baseline is its own task.
4. If the failure is in code the task touched, it is yours: fix it, then re-run the same tier.

## Decision Table

| Task type | Tier |
|---|---|
| Trivial (fast-track — see "Trivial Change Fast-Track" above) | `test-fast` only, no escalation |
| UI copy / style / layout only | `test-fast` |
| New UI component (no API changes) | `test-fast` |
| Bug fix contained to one component | `test-standard` |
| New feature touching existing API endpoints | `test-standard` |
| New settings key or store field | `test-standard` |
| Performance / caching change | `test-standard` |
| E2E test fix or new E2E spec | `test-standard` + `e2e-repro` |
| New API endpoint or route | `test-heavy` |
| Schema / Drizzle migration | `test-heavy` |
| Auth, rate-limit, or security change | `test-heavy` |
| Refactor spanning multiple packages | `test-heavy` |

## Escalation Rules

These rules do **not** apply to trivial fast-track tasks or tasks whose plan names a tier (see above). Otherwise, escalate **one tier up** if any of these are true:

- The task touches `lib/api-spec/openapi.yaml` or `orval.config.ts` (codegen inputs) → at minimum `test-standard`; add `test-heavy` if a new route is introduced.
- The task touches `lib/db/src/schema/` (Drizzle schema) → `test-heavy`.
- The task touches `artifacts/api-server/src/middleware/` or rate-limit logic → `test-heavy`.
- The task touches more than two packages in the monorepo → `test-heavy`.
- A previous run of `test-fast` or `test-standard` surfaced a failure in a step beyond its tier → escalate until the failure is caught by the chosen tier.

## E2E Commands

`e2e-repro` and `test-e2e-palette` are **separate** from the tiered commands and are **not** included in any tier. Use them only when the task explicitly:
- Fixes a flaky or broken Playwright spec, or
- Introduces a new E2E spec.

When both apply, run `test-standard` **and** `e2e-repro` (in that order, since `test-standard` confirms nothing broke and `e2e-repro` confirms the E2E change works).

## Budget Keys

Time budgets are defined in `tests/timeout-guard/budgets.json`:
- `tierFast.runBudgetMs` — 300 000 ms (5 min)
- `tierStandard.runBudgetMs` — 1 200 000 ms (20 min)
- `aggregate.totalBudgetMs` — 3 000 000 ms (50 min)

## Implementation

`scripts/run-tier.mjs` accepts a positional tier argument (`fast | standard | full`) plus optional repeatable `--skip <step-name>` flags, and runs the corresponding slice of steps with per-step timing output. It exits non-zero on first failure (fail-fast).

- `fast` = steps 1–5 (typecheck, lint, check:lock-skill-sync, check:root-relative-api, check:deps-suppression)
- `standard` = steps 1–9 (adds test:unit, check:docs-stale, check:catalog-coverage, check:schema-stale)
- `full` = all steps (available but not currently used by any registered command)

`test-fast` and `test-standard` wrap `run-tier.mjs` with `scripts/run-with-timeout.mjs <budgetKey>` to enforce wall-clock budgets.

`test-heavy` uses `scripts/test-heavy-serial.mjs` which runs `run-tier.mjs standard --skip test:unit` as a fail-fast preflight, then serializes the three heavy suites (test:unit, e2e-palette, test:e2e) with port sweeps between them. The heavy suites use no-fail-fast so all failures are reported in a single pass.

The canonical command strings and their budget keys are maintained in `scripts/register-validation-commands.mjs` (importable as an ES module). After a fresh environment setup, an agent should import that file from the code_execution sandbox and call `setValidationCommand({ name, command })` for each entry to restore the registrations.
