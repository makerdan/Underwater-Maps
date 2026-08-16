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

# Baseline failures as of 2026-08-16 (confirmed on clean tree at main HEAD)

4. **`bathyscan src/__tests__/ThrottlePanel.test.tsx`** — "re-syncs the input
   when the units preference flips live" fails `expected '19.9' to be '15'`,
   3/3 solo and on a clean tree. Fails test:unit in every standard+ tier run.

5. **`check:fixture-freshness` survey.laz** — committed d19b443f vs generated
   83e89bee; generated hash is STABLE across runs (not per-run nondeterminism),
   so it stays stale until someone regens+commits per laz-fixture-nondeterminism.md.

6. **`check:audit`** — 5 NEW unexempted high advisories (undici degenerate
   cache directives, js-yaml !!omap, pdf.js JS execution, nanoid ×2) now exit 1;
   they are NOT in the EXCEPTIONS list, so the full tier fails at check:audit
   even when everything else is green.

**How to apply:** if a completion-validation run fails only on these, verify
your own diff is unrelated, then finalize with a skip reason rather than
fixing the baseline (that is its own task). Remove this file once the
baselines are repaired.
