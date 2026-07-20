---
name: Duplicate-hooks parser and forwardRef components
description: appTsxDuplicateHooks parser needs pending-scope handling for React.forwardRef-style declarations
---
The duplicate-hook scanner's completeness check (regex count) and its scope parser use different logic. A component declared as `export const X = React.forwardRef<...>(` has no `{` on the declaration line, so the scope parser found 0 hooks while the completeness scan demanded the file be listed — an unsatisfiable pair.

**Why:** the parser only opened a scope when the declaration line itself had positive brace delta.

**How to apply:** the parser now opens a pending scope at depth 0 when a matched declaration line ends with `(`, `<`, or `,`; the body's `{` on a later line raises depth. If another wrapper style (e.g. `memo(` on its own line) trips the sanity check, extend the same pending-scope branch rather than excluding the file.
