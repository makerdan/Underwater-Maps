---
name: palette-cross-device-sync e2e baseline failure
description: One palette e2e spec fails deterministically in baseline (2026-07-21); triage before blaming an unrelated diff.
---

As of 2026-07-21, `tests/e2e/palette-cross-device-sync.spec.ts:107` ("Custom-theme band colour reaches PUT /api/settings payload and rehydrates on a fresh device") fails deterministically — solo run with the validation lock free: 1 failed / 24 passed, retry included. Symptom: after fresh-device rehydrate, the band hex input never receives the new colour (`toHaveValue` timeout at line 252); an earlier browser console error shows `PUT /api/settings failed: TypeError: Failed to fetch` under load, but the solo failure is the rehydrate assertion.

**Why:** confirmed unrelated to test-only diffs (reproduced with a diff touching only unit-test files); likely introduced by recent palette/land-nodata colour work.

**How to apply:** if test-e2e-palette fails only on this spec and your task didn't touch palette/settings-sync code, treat it as pre-existing baseline breakage — record and move on. Remove this note once the spec is green.
