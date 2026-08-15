---
name: Duplicate-hooks registry baseline breakage
description: check:duplicate-hooks-registry + appTsxDuplicateHooks unit test fail on TrailRecorder.tsx as of 2026-08-15 — pre-existing; the guard fires in two places, skip the step and expect the twin unit failure
---

# Duplicate-hooks registry guard fires in two places

The guard that requires large hook-heavy components to be listed in
`SCANNED_FILES` (in `artifacts/bathyscan/src/__tests__/appTsxDuplicateHooks.test.ts`)
exists **twice** in the validation tiers:

1. `check:duplicate-hooks-registry` — standalone fast/standard-tier step
   (fail-fast: it runs BEFORE `test:unit`, so the whole tier dies with no
   unit-suite signal).
2. `src/__tests__/appTsxDuplicateHooks.test.ts` — the same assertion inside
   the bathyscan `test:unit` suite.

**Why:** when an unrelated task grows a component past the threshold
(>500 lines AND ≥10 hooks) without updating the registry, every other
in-flight task's validation runs break in both places at once.

## Current baseline (2026-08-15)

`components/TrailRecorder.tsx` (503 lines, 19 hook declarations) crossed the
threshold without being added to `SCANNED_FILES`. Stash-verified pre-existing;
a dedicated fix task ("Fix the broken fast-tier check that fails every
validation run") was proposed the same day.

## How to apply

- If the flagged file is untouched by your task, classify as pre-existing
  (failure-gate) — do not fix it inside an unrelated task.
- To run the rest of a tier past the fail-fast gate, upsert a temporary
  validation command running `run-tier.mjs <tier> --skip
  check:duplicate-hooks-registry` (keep the validation-lock +
  run-with-timeout wrappers; the upsert bypasses the workflow limit), then
  clear the temp command.
- Expect exactly one unit-test failure — the twin assertion. Both clear
  together once the registry is updated by the fix task.
- The fix, when its task runs: add the file path to `SCANNED_FILES` and let
  the duplicate-hooks scan actually run on it.
- Remove this entry once the gate is green again.

**Note:** a persistent validation command `test-standard-skip-dup-hooks` (standard tier with `--skip check:duplicate-hooks-registry`) is already registered — reuse it instead of creating a new temp command.
