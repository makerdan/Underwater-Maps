---
name: Duplicate-hooks parser and forwardRef components
description: appTsxDuplicateHooks parser needs pending-scope handling for React.forwardRef-style declarations
---
The duplicate-hook scanner's completeness check (regex count) and its scope parser use different logic. A component declared as `export const X = React.forwardRef<...>(` has no `{` on the declaration line, so the scope parser found 0 hooks while the completeness scan demanded the file be listed — an unsatisfiable pair.

**Why:** the parser only opened a scope when the declaration line itself had positive brace delta.

**How to apply:** the parser now opens a pending scope at depth 0 when a matched declaration line ends with `(`, `<`, or `,`; the body's `{` on a later line raises depth. This covers forwardRef, memo, and memo(forwardRef(…)) — dedicated parser tests in the same file lock the behavior in, and the SENTINEL_EXCLUDED escape hatch was removed (TerrainMesh is fully scanned). If another wrapper style trips the sanity check, extend the same pending-scope branch rather than reintroducing an exclusion list.
