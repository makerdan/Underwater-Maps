# Bug & Error Audit Report — Pre-existing Failures + Fresh Signal Sweep

**Scope:** All documented baseline failures (memory: `unit-tier-baseline-2026-08.md`, `full-e2e-known-failures.md`) plus a fresh signal sweep of the full `test-standard-plus` tier, `pnpm audit`, and a solo run of the one documented e2e baseline. NOT a full 10-category codebase audit — category passes were applied only to the failing suites/scripts under investigation.
**Mode:** report-only (no code, config, test, or dependency changes; the only tracked change is this report)
**Date:** 2026-08-17
**Baseline commit:** `9d532f92` (clean tree at audit start)
**Stack:** TypeScript monorepo (pnpm), React 19 + Vite (bathyscan), Express (api-server), Vitest, Playwright 1.60. Gated categories not exercised outside the failing suites (per task scope).

---

## Summary

The headline result: **most of the documented baseline is already fixed.** Four of the six documented baseline failures were resolved on 2026-08-16 (the day after the baseline memory was written) and verified green in this audit. The live failures are concentrated in **test/tooling infrastructure**, not product code:

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 2 |
| Low | 1 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| 1 | High | Type safety (test bug) | `tests/e2e/overview-puzzle-multiselect.spec.ts:268,383,436` | Unsupported `expect.poll(...).toSatisfy` matcher crashes 3 of 6 tests deterministically |
| 2 | High | State & data integrity (tooling) | `.local/tasks/` × 909 files (gate: `scripts/check-failure-gate.mjs`) | Plan-lint gate blocks EVERY validation tier; fixes to the gitignored archive cannot persist |
| 3 | Medium | State & data integrity (tooling) | `.local/tasks/offline-estimate-fix-and-gb-format.md`, `.local/tasks/offline-pack-include-markers.md` | 2 plan files with partially-filled Regression Guard sections; `--fix-stub` cannot repair them |
| 4 | Medium | State & data integrity (tooling) | `.local/custom_skills/` × 9 mirrors (gate: `scripts/check-skill-mirror-sync.mjs`) | Stale skill mirrors failed every tier in this environment until re-synced |
| 5 | Low | Dependency hygiene | `pnpm-lock.yaml` (jsdom→undici, postcss) | 6 audit vulns (5 moderate + 1 exempted high), all test-only devDep paths |

**Product code: zero live findings.** Typecheck, lint, all unit suites (bathyscan + api-server shards + api-zod: 0 failures), and every static guard except the plan-archive lints are green on the clean tree.

---

## Findings

### Finding 1 — `expect.poll(...).toSatisfy` is not a Playwright matcher (3 deterministic e2e failures)
- **File and line:** `tests/e2e/overview-puzzle-multiselect.spec.ts:268`, `:383`, `:436` (failing at runtime); `:391` and `:445` use the same pattern but sit after the first crash in their tests. 5 call sites total.
- **Category:** Type safety — test bug (runtime call to a method that does not exist; the type layer fails to reject it)
- **Severity:** High
- **Risk:** `toSatisfy` is a Vitest matcher; Playwright 1.60's `expect.poll()` supports only generic matchers (`toBe`, `toEqual`, `toContain`, …). Every test reaching one of these calls throws `TypeError: _fixtures.expect.poll(...).toSatisfy is not a function`. Verified solo (validation run `gI9ByJv_HGGsLUIQgEvf-`): **3 failed / 3 passed, deterministic across Playwright's built-in retry**. This permanently reds the palette e2e suite, masking any real regression in the Overview puzzle feature (group creation, sessionStorage round-trip, reset are all effectively untested). The failure is in the test only — the feature itself was not shown to be broken.
- **Recommended fix:** Replace each `expect.poll(fn).toSatisfy(pred)` with `expect.poll(async () => pred(await fn())).toBe(true)` (or `waitForFunction`). Mechanical, single-spec change at 5 sites — small standalone task. Worth a follow-up grep guard: `toSatisfy` appears only in this spec (`grep -rn toSatisfy tests/e2e` → 5 hits, 1 file). Also worth checking why `tsc` accepts it (Vitest's `expect` type augmentation leaking into the e2e tsconfig scope).

### Finding 2 — Plan-file lint gate (`check:failure-gate`) blocks every validation tier: 909 non-compliant files, and the fix can't stick
- **File and line:** `.local/tasks/*.md` (909 of 1007 files); gate wired in `scripts/validation-steps.mjs` (steps `fix:failure-gate-stubs`, `check:failure-gate`, runs in fast/standard/full tiers)
- **Category:** State & data integrity — tooling/CI design flaw
- **Severity:** High
- **Risk:** On the clean tree, `test-standard-plus` dies at `check:failure-gate` ~40 s in — before test:unit or any full-tier guard runs (verified: run `3EEdTg158VZ8cZVLe8Mhv`). Every tier (fast/standard/full) contains this step, so **all completion validation is currently red for every task**, forcing skip-reason completions and eroding the validation signal. Root cause is structural, not just backlog: the plan archive lives in gitignored `.local/tasks/`, so compliance fixes cannot propagate through git — commit `e3287752` ("Bulk-fill ~909 pre-mandate **Why:** stubs") already fixed this once, but the filled files were never tracked, so any fresh/parallel environment regenerates the backlog. A bulk-fill alone will recur.
- **Recommended fix:** Proposed task #4032 covers the bulk-fill; it should ALSO include a durable fix or it will bounce: either (a) scope the gate to the current task's plan file (`TASK_PLAN_FILE`) plus recently-modified plans, (b) move the plan archive to a tracked path, or (c) have `--fix-stub` write self-satisfying pre-mandate stubs (filled, not placeholder) for files older than the mandate date. Own task (already proposed — approve #4032).

### Finding 3 — 2 plan files fail the Regression Guard gate and require manual filling
- **File and line:** `.local/tasks/offline-estimate-fix-and-gb-format.md`, `.local/tasks/offline-pack-include-markers.md` (gate: `fix:regression-guard-stubs` / `check:regression-guard`)
- **Category:** State & data integrity — tooling/CI
- **Severity:** Medium
- **Risk:** These two files have an existing `## Regression Guard` section with missing `**Covers:**` / `**Test location:**` / `**What it checks:**` fields, so `--fix-stub` refuses to auto-repair them (it only stubs files missing the section entirely) and the gate exits 1. Verified: with `check:failure-gate` skipped, the tier then dies here instead (run `scd4FEvdfxgymIII-xdJv`) — a second independent blocker on the same gitignored archive.
- **Recommended fix:** Fill the three fields in both files by hand (or convert to a justified `**N/A**`). Fold into task #4032's cleanup pass — same root cause as Finding 2, no separate task needed.

### Finding 4 — Stale skill mirrors (`check:skill-mirror-sync`) failed every tier in this environment
- **File and line:** `.local/custom_skills/<9 skills>/.fingerprint` vs canonical `.agents/skills/*/SKILL.md`; gate `scripts/check-skill-mirror-sync.mjs`
- **Category:** State & data integrity — environment hygiene
- **Severity:** Medium
- **Risk:** The first sweep attempt (run `k_9jC8W73nZht7sgUFmsM`) failed at `check:skill-mirror-sync` with 9 stale mirrors — skill files merged by other tasks whose post-merge sync never ran in this environment. Until synced, every tier in the environment is red at ~40 s, and agents read outdated skill instructions. This is the known recurrence pattern from memory (`skill-mirror-sync-check`), now confirmed to still bite on fresh task environments.
- **Recommended fix:** Make the check self-healing: since mirrors are gitignored derived copies of tracked canonical files, `check:skill-mirror-sync` can safely re-copy + re-fingerprint instead of failing (keep a warning). Small standalone task. **Audit disclosure:** to unblock the sweep, I ran the sanctioned post-merge sync block (copies canonical SKILL.md → gitignored mirrors). This touched only gitignored files; zero tracked changes.

### Finding 5 — `pnpm audit --audit-level=moderate`: 6 vulnerabilities, all dev-only paths
- **File and line:** `pnpm-lock.yaml` — `artifacts__bathyscan>jsdom>undici` (undici ≥7.0.0 <7.29.0: 1 high GHSA-4cwx-7wf7-3272 + 4 moderate GHSA-8xcm-r25x-g524, GHSA-m8rv-5g2x-5cg5, GHSA-jr45-8vmc-qm54, GHSA-v3r7-h72x-cjcm), plus 1 moderate PostCSS advisory
- **Category:** Dependency hygiene
- **Severity:** Low
- **Risk:** All undici paths route through jsdom, a test-only devDependency — none ship in a deployed service. The single high is already a documented, dated exception in `scripts/check-audit.mjs` (`fixDate: 2026-10-17`) because jsdom 29.1.1 hard-requires undici <7.28.0 internals, so the registered `check:audit` gate is **green**. Residual risk is only that raw `pnpm audit -–audit-level=moderate` (the standalone `audit` workflow) stays red, and the exception goes stale if jsdom lags past October.
- **Recommended fix:** Own (scheduled) task: upgrade jsdom when a release ships undici ≥7.29.0, then drop the GHSA-4cwx exception; bump postcss at the same time. Nothing actionable today without breaking Vitest/jsdom (documented in check-audit.mjs).

---

## Resolved since documentation (stale baseline entries)

All verified in this audit on the clean tree at `9d532f92`:

| Documented baseline | Status | Evidence |
|---|---|---|
| `ThrottlePanel.test.tsx` "re-syncs input" fails `'19.9' ≠ '15'` | **FIXED 2026-08-16** (`da69d537` — test-isolation fix: seed driveBoatStore in `renderWithState`, reset in `beforeEach`; the leak was test 3's committed 19.9 mph bleeding into test 4) | 3/3 solo runs pass; green in full-tier test:unit |
| `check:audit` — 5 unexempted high advisories (undici, js-yaml `!!omap`, pdf.js, nanoid ×2) | **FIXED 2026-08-16** (`0fe8dc81` — dependency bumps in package.json/pnpm-workspace + documented undici exception) | Solo run exits 0; green in tier run |
| `check:fixture-freshness` — survey.laz hash d19b443f ≠ 83e89bee | **FIXED 2026-08-16** (`c89b5446` — .laz compared size-only, since lazrs embeds environment-dependent bytes) | Green in tier run: `ok survey.laz 440 B (size match)` |
| `api-server routes-documented.test.ts` | **FIXED 2026-08-16** (per baseline note; subsequently `9349245c` documented the route in openapi.yaml properly) | Solo run: 1 passed |
| Full-e2e 9 deterministic failures (July 2026) | Already documented fixed 2026-07-30 in memory; not re-run (out of audit scope) | memory `full-e2e-known-failures.md` |
| `pnpm audit` — "10 vulns (5 moderate, 5 high)" | **Stale count** — now 6 (5 moderate, 1 high) after `0fe8dc81` | Finding 5 |

The corresponding memory topic files have been updated as part of normal memory maintenance so future tasks stop treating these as live baselines.

## Flaky / load-artifact classifications

- **overview-puzzle-multiselect "one 60 s timeout"** (documented alongside the toSatisfy failures): **NOT reproduced solo** — the solo run completed all 6 tests in 49.6 s with zero timeouts (3 toSatisfy failures + 3 passes only). Classified as a **load artifact** of running inside the serialized palette-e2e suite under full-suite CPU pressure. No standalone finding; it should disappear once Finding 1 unreds the spec (re-check then).

## Tooling signals (Phase 0 sweep)

Sweep = one `test-standard-plus` run on the clean tree. It required three attempts to get past environment/plan-archive gates — each early death is itself recorded as a finding above:

1. Run `k_9jC8W73nZht7sgUFmsM` — died at `check:skill-mirror-sync` (Finding 4).
2. Run `3EEdTg158VZ8cZVLe8Mhv` — died at `check:failure-gate`, 909 files (Finding 2).
3. Run `Yf1RG-4rdQviA0HPyQhCA` — same tier with ONLY the plan-archive gates skipped (`--skip check:failure-gate --skip fix:regression-guard-stubs --skip check:regression-guard`): **PASSED, all 32 remaining steps green in 7.6 min**.

- Typecheck: clean (20.2 s, includes codegen freshness)
- Lint: clean (15.7 s)
- Unit tests: **all green** — bathyscan 1538 passed / 11 skipped (114 files); api-server both shards passed (1775 passed / 4 skipped each pass); no unhandled-error gate trips
- Static guards: all green — incl. `check:fixture-freshness`, `check:ports`, `check:port-drift`, `check:audit`, `check:docs-stale`, `check:schema-stale`, `check:skip-count`, `audit:marker-bbox`
- Dependency audit: registered gate `check:audit` green (1 exempted high); raw `pnpm audit --audit-level=moderate` red with 6 dev-only vulns (Finding 5)
- Solo e2e (documented baseline spec): 3 failed / 3 passed (Finding 1)

Environment side effects of the sweep (all gitignored, zero tracked changes): the tier's own `fix:*` steps appended stubs to `.local/tasks` plan files; the skill mirrors were re-synced (Finding 4 disclosure); temporary validation commands used for the solo e2e run and the gate-skipping tier run were registered and removed.

## Deferred / not audited

- Full 10-category audit of application code — explicitly out of scope (user chose baselines + fresh sweep).
- Playwright full/palette suites beyond the one documented baseline spec — not part of any tier; the 2026-07 e2e baseline is documented fixed.
- Fixing anything, bumping dependencies, editing the check:audit exceptions, regenerating survey.laz — out of scope (report-only).

## Suggested fix order

1. **Finding 1** — replace the 5 `toSatisfy` poll sites (small, mechanical, restores palette-e2e signal for the puzzle feature). Standalone micro-task.
2. **Findings 2 + 3** — approve proposed task #4032 (plan-file backlog), expanded to include the 2 regression-guard files and a **durable** fix (gate scoping or tracked archive) so the backlog cannot recur. Without the durable part, this red returns in every fresh environment and keeps forcing skip-reason completions.
3. **Finding 4** — make `check:skill-mirror-sync` self-healing (re-copy instead of fail). Small task; could ride along with #4032's CI-hardening.
4. **Finding 5** — scheduled dependency task: jsdom→undici ≥7.29.0 + postcss bump, then remove the GHSA-4cwx exception (deadline already tracked: 2026-10-17).
