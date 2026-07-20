---
name: Validation tiers
description: Three tiered validation commands for BathyScan — fast/standard/heavy — and when to pick each.
---

# Validation Tiers

## Tiers

| Command | Script arg | Steps | Budget |
|---|---|---|---|
| `test-fast` | `fast` | typecheck, lint + quick static checks | 5 min |
| `test-standard` | `standard` | + test:unit, check:docs-stale, check:catalog-coverage, check:schema-stale | 20 min |
| `test-heavy` | (serial runner) | preflight `standard --skip test:unit` + test:unit + e2e-palette + test:e2e | 50 min |

Fast/standard delegate to `scripts/run-tier.mjs <tier>`; heavy uses `scripts/test-heavy-serial.mjs`. `run-tier.mjs` supports repeatable `--skip <step>` flags. `check:port-drift` is full-tier only. Heavy's test:unit step has no per-step budget — covered by the `aggregate` budget.

## Quick Decision Rules

- UI/copy/style/new component only → `test-fast`
- Bug fix, new feature on existing endpoint, new settings key, perf/caching → `test-standard`
- New route, schema migration, auth/security, multi-package refactor → `test-heavy`
- E2E fix or new spec → `test-standard` + `e2e-repro`

**Why:** Running `test-heavy` for every task costs 45–105 min unnecessarily. `test-fast` and `test-standard` have 5 min and 20 min budgets respectively (`tierFast`/`tierStandard` in `tests/timeout-guard/budgets.json`).

**How to apply:** Before picking a validation command, check the task type against the decision table in `.agents/skills/validation-tiers/SKILL.md`. Escalate one tier if the task also touches codegen inputs, Drizzle schema, or middleware.
