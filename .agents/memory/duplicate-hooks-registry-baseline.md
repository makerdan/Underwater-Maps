---
name: Duplicate-hooks registry baseline breakage
description: check:duplicate-hooks-registry (fast tier) + appTsxDuplicateHooks unit test fail on TrailRecorder.tsx as of 2026-08-15 — pre-existing, do not re-investigate
---


# Duplicate-hooks registry baseline breakage

As of 2026-08-15, every validation tier fails at `check:duplicate-hooks-registry`
(fast-tier step, fail-fast blocks the rest of the tier) and, if skipped, the unit
suite fails the mirrored test
`appTsxDuplicateHooks.test.ts > SCANNED_FILES must stay complete`:

```
components/TrailRecorder.tsx (503 lines, 19 hook declarations)
```

TrailRecorder.tsx crossed the >500-line / ≥10-hook threshold without being added
to the `SCANNED_FILES` array in
`artifacts/bathyscan/src/__tests__/appTsxDuplicateHooks.test.ts`.

**Verified pre-existing:** fails on main with unrelated changes stashed
(2026-08-15). A dedicated fix task ("Fix the broken fast-tier check that fails
every validation run") was proposed the same day.

**How to apply:** treat this failure as baseline breakage — do not fix it inside
an unrelated task. To run the rest of a tier past the fail-fast gate, use a
temporary validation command with
`run-tier.mjs <tier> --skip check:duplicate-hooks-registry` (keep the
validation-lock + run-with-timeout wrappers), then clear the temp command.
Remove this entry once the fix task merges and a tier run passes the step.
# check:duplicate-hooks-registry baseline breakage (2026-08-15)

`check:duplicate-hooks-registry` fails because `components/TrailRecorder.tsx`
crossed the qualifying threshold (>500 lines AND ≥10 hook declarations — now
503 lines / 19 hooks after the trail-recording feature work) without being
added to the `SCANNED_FILES` array in
`artifacts/bathyscan/src/__tests__/appTsxDuplicateHooks.test.ts`.

**Why this matters:** the check runs early in the standard tier's fail-fast
sequence, so every `test-standard`(+) run dies BEFORE `test:unit` executes.
Tasks validating during this window get no unit-suite signal from the tier.

**How to apply:**
- Treat this failure as pre-existing (stash-verified fails on main) — do not
  investigate it per-task; fixing it is its own task.
- To still get signal for a localized change, run the touched test files solo
  with vitest and rely on the tier's typecheck+lint (which run before the gate).
- The fix, when its task runs: add the file path to `SCANNED_FILES` (and let
  the duplicate-hooks scan actually run on it).
- Remove this entry once the gate is green again.

**Note:** a persistent validation command `test-standard-skip-dup-hooks` (standard tier with `--skip check:duplicate-hooks-registry`) is already registered — reuse it instead of creating a new temp command.
