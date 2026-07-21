---
name: terrain-land-clamp baseline breakage
description: terrain-land-clamp.test.ts failing in baseline (2026-07-21); not caused by unrelated tasks — triage before blaming your diff.
---

As of 2026-07-21, `artifacts/bathyscan/src/__tests__/terrain-land-clamp.test.ts` fails 6/7 tests in the baseline (fails solo, unrelated changes present). Symptoms: land vertices come out at negative Y (e.g. -2.5, -50) instead of clamped 0 — consistent with the land clamp using `Math.min(depth, 0)` instead of `Math.max(depth, 0)` (see depth-sign-convention.md).

**How to apply:** if `test:unit` in test-standard/heavy fails only on this file and your task didn't touch terrain geometry, treat it as pre-existing baseline breakage — record and move on, don't escalate tiers. Remove this note once the file is green again.
