---
name: Concurrent codegen runs race on generated api.ts
description: typecheck and test-all both run api-spec codegen; concurrent runs corrupt the patch step
---
Running the `typecheck` workflow while `test-all` (or any other workflow that runs `codegen:generate`) is mid-codegen can fail with `patch-zod-integer-settings: missing .int() on fields: …`.

**Why:** both runs rewrite `lib/api-zod/src/generated/api.ts`; one orval regeneration can overwrite the other run's already-patched file between its patch and verify steps, so the verify pass sees unpatched fields and exits 1.

**How to apply:** treat this failure as a scheduling race, not a schema regression — re-run typecheck alone once other codegen-running workflows are past their codegen step. A clean solo run confirms there is no real drift.
