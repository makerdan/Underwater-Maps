---
name: duplicate-hooks-registry baseline breakage
description: check:duplicate-hooks-registry fails on TrailRecorder.tsx since 2026-08-15 — pre-existing, blocks standard-tier fail-fast before test:unit.
---

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
