---
name: Hand-edited generated api.ts trap
description: Fields added directly to lib/api-zod generated output vanish on regeneration; openapi.yaml is the only source of truth.
---

# Hand-edited generated api.ts trap

**Rule:** Never add fields by editing `lib/api-zod/src/generated/api.ts` (or any
generated client) directly — put them in `lib/api-spec/openapi.yaml` and re-run
codegen. Any field that exists only in the committed generated file is silently
dropped the next time anyone runs codegen (which the root `typecheck` script
does automatically).

**Why:** Fields hand-edited into the generated zod schemas were removed by the
next codegen regeneration, so the server-side parse silently stripped them and
a round-trip test failed far from the cause. Bonus trap: a hand-edited
generated file can drift into a TDZ (used-before-declaration) state that
crashes on import, masking the failure as "no tests collected".

**How to apply:** When a generated-schema round-trip test fails after codegen
runs, check whether the field exists in `lib/api-spec/openapi.yaml`; if it only
exists in the committed generated file, that's the bug. Fix by adding the field
to the YAML schema and regenerating (plus `typecheck:libs` to re-emit .d.ts).
