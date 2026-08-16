---
name: Unit/e2e baseline failures, Aug 2026
description: Known pre-existing failures blocking test-standard/heavy and palette e2e as of 2026-08-15; not caused by test-only tasks.
---

# Baseline failures as of 2026-08-15

Confirmed by solo re-runs on a clean tree (not concurrency artifacts):

1. **`api-server src/__tests__/routes-documented.test.ts`** — FIXED 2026-08-16:
   `POST /trails/{id}/soft-delete` added to `UNDOCUMENTED_ALLOWLIST` with
   rationale (beacon fallback, intentionally internal). No longer a baseline.

2. **`tests/e2e/overview-puzzle-multiselect.spec.ts`** — multiple tests fail
   with `expect.poll(...).toSatisfy is not a function` (Playwright's
   poll matchers don't include `toSatisfy`; the spec uses an unsupported
   matcher), plus one 60 s timeout. Fails the palette e2e suite
   deterministically.

3. **`pnpm audit --audit-level=moderate`** — 10 vulns (5 moderate, 5 high),
   mostly `undici` via `jsdom` in bathyscan devDeps. Pre-existing.

**How to apply:** if a completion-validation run fails only on these, verify
your own diff is unrelated, then finalize with a skip reason rather than
fixing the baseline (that is its own task). Remove this file once the
baselines are repaired.
