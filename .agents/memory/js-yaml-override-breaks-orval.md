---
name: js-yaml override breaks orval ESM import
description: pnpm overrides for js-yaml >=4.2.0 resolve to v5.x (different major), breaking orval's ESM import in codegen pipeline.
---

The rule: **never add a `js-yaml` override to pnpm-workspace.yaml**.

js-yaml v4.x latest is 4.1.1 — v4.2.0 does not exist on npm.
A `js-yaml: '>=4.2.0'` override resolves to v5.x (next major), which
changed its ESM export shape. orval imports `js-yaml` with a default
import; v5 has no `default` export, causing:

```
SyntaxError: The requested module 'js-yaml' does not provide an export named 'default'
```

This kills the entire codegen pipeline (exit code 127 → "orval not found"
is the surface error from codegen-locked.mjs, but the real cause is
js-yaml failing to load before orval even starts).

**Why:** The GHSA for js-yaml merge-key DoS only affects 4.x, and 4.1.1
is the last 4.x release. There is no patched 4.x to upgrade to; the fix
is a v5 major rewrite. Orval bundles its own copy via its transitive deps,
so the exposure is build-toolchain-only and accepted as low-severity.

**How to apply:** If pnpm audit flags js-yaml, document it as accepted
low-severity in pnpm-workspace.yaml comments. Do NOT add an override.
