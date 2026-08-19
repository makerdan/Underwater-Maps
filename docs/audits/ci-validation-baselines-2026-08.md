# CI validation baseline audit — 2026-08-19

## Evidence window and method

This audit used GitHub Actions runs from 2026-08-18 15:07 UTC through
2026-08-19 05:29 UTC, after portable validation routing was established.
Job time is the GitHub job `started_at` → `completed_at` span; it includes
runner startup, checkout, dependency/install work, and validation. Test-step
time is taken from the named test step where a completed sample exposed it.
Cancelled and failing runs are retained as operational evidence but are not
treated as clean-duration baselines.

| Validation job | Clean samples | Observed job range | Validation observation | Ceiling decision |
| --- | ---: | ---: | --- | --- |
| PR static + unit suites | no completed clean post-routing sample | failing fast at 40–300 s | no valid full-test duration yet | retain 35 min; re-audit after three clean runs |
| PR Playwright smoke | no PR event sample yet | no valid runner duration yet | no clean GitHub-runner sample supports a lower ceiling | retain **30 min**; re-audit after three clean runs |
| Main Playwright full | no completed clean post-routing sample | cancelled at 45 min; prior run reached 281/329 tests | current evidence does not prove a lower safe ceiling | retain **45 min** |
| Main palette/settings sync | two failed jobs | 13–14 min | failures are operational evidence, not clean ceiling evidence | retain **30 min**; re-audit after three clean runs |
| Drift detection | 10 successful jobs | 54–112 s | all six drift classes complete inside that job span | 20 → **10 min** |
| BathyScan unit workflow | 10 successful jobs | 4m 21s–5m 44s | unit suite is the validation step | retain **10 min** (more than four minutes of cold-run headroom) |

The approval-gate job is deliberately not time-tuned: its elapsed time is
human-review waiting time, not runner execution time.

## Runner policy versus local policy

GitHub job ceilings protect a fresh Ubuntu runner, action downloads, browser
installation, service containers, and the job’s own retry policy. They are
configured only in `.github/workflows/`.

Replit-local per-test, hook, file, RSS, runner, tier, and aggregate budgets
remain exclusively in `tests/timeout-guard/budgets.json`. They protect agent
validation under shared-host contention and serialize local test processes.
No value in that file changed in this audit: GitHub timing is not evidence
that a local budget is stale.

## Runtime browser coverage

The previous list/HTML reporters hid the final aggregate outcome behind console
logs. Each existing GitHub Playwright command now additionally writes
`test-results/ci-playwright-results.json`, appends its passed/failed/skipped
counts and every runtime skip reason to the job summary, uploads it on every
outcome, and checks it against `tests/e2e/runtime-skip-baseline.json`.

The main-suite baseline of 44 comes from two independent 2026-08-19 GitHub
runner samples, which each emitted the same 44 dynamic skips before later
unrelated failures/cancellation. PR smoke and palette/settings had no observed
runtime skips in their selected coverage. An increase fails; a lower clean
result passes with a mandatory ratchet reminder. The data file is intentionally
separate from the static source-count baseline.

## Static skip-site re-audit

`scripts/check-skip-count.mjs` currently reports:

- unit static skip sites: **0** (fixed zero baseline);
- E2E conditional `test.skip(` call sites: **234**.

The old audit text incorrectly said 233 while the checked-in baseline and
actual scanner both said 234. This audit corrects the document only; it does
not raise a baseline to mask CI. The seven existing categories remain
environment-gated reasons, not permission to turn failing assertions into
skips.

## Follow-up measurement rule

After three clean runs for any row currently lacking a clean sample, replace
the provisional evidence with the observed clean range. Use the slowest clean
run (or a documented high percentile when there are enough samples) plus the
same explicit startup/retry margin. Do not change suite membership, worker
count, retries, Playwright test timeouts, or Replit-local budgets as part of
that measurement.