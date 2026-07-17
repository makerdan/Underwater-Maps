---
name: js-yaml override breaks orval ESM import
description: pnpm overrides for js-yaml >=4.2.0 resolve to v5.x (different major), breaking orval's ESM import in codegen pipeline.
---

The rule: **use `'>=4.2.0 <5'` for the js-yaml override**, never `'>=4.2.0'`.

js-yaml 4.2.0 and 4.3.0 DO exist (npm tag: `v4-legacy`), but `npm show`
hides them — only `npm show js-yaml@'>=4.2.0 <5' version` reveals them.
`pnpm audit` reports the patched version as `>=4.2.0`.

A bare `js-yaml: '>=4.2.0'` override resolves to v5.x (latest), which
changed its ESM export shape. orval imports `js-yaml` with a default
import; v5 has no `default` export, causing:

```
SyntaxError: The requested module 'js-yaml' does not provide an export named 'default'
```

This kills the codegen pipeline (surface error is "orval not found" / exit 127
from codegen-locked.mjs, but the real cause is js-yaml failing before orval starts).

**Correct override:** `js-yaml: '>=4.2.0 <5'` — resolves to 4.3.0, stays in 4.x.

**Why:** Static source-search tests also catch the literal string "delete extras.__updatedAt"
even in comments — remove the string from comments too, not just code.

**How to apply:** Use the range `'>=4.2.0 <5'` whenever adding a js-yaml audit override.
