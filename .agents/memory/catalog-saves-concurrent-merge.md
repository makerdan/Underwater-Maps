---
name: catalog-saves.ts concurrent-merge damage
description: Pattern for diagnosing and repairing merge conflicts when multiple task agents modify the same route file simultaneously.
---

## The rule

When several task agents land PRs against the same route file in rapid succession, the resulting merges can:
1. **Drop the `router.post(...)` wrapper line** — leaving handler body code floating at module scope (esbuild fails first with "already declared" duplicate-const errors)
2. **Duplicate destructure lines** — same `const { a, b } = ...` appears twice consecutively
3. **Corrupt variable names inside the body** — e.g. `west/south/east/north` where the destructured names are `minLon/minLat/maxLon/maxLat`, or `updated.catalogId` where `updated` is not yet in scope
4. **Cross-pollinate `.set({})` calls** — e.g. retry route gets `.set({ folderId })` from the rename/move route that was merged in parallel

**Why:** Git merge picks up the last-write for conflicting hunks; if two tasks each rewrote the same function header with different content, the loser's body can be spliced next to the winner's header.

## How to apply

When the API server build fails with esbuild "already declared" errors:
1. Read the broken section — look for the floating body (no enclosing `router.*` call)
2. `git log --oneline -8 -- <file>` to find the last good commit before the damage
3. `git show <good-sha>:<file> | sed -n '<start>,<end>p'` to see the correct handler
4. Restore: add back the `router.post(...)` wrapper, remove duplicate lines, fix variable names

Common wrong-variable patterns seen:
- `west/south/east/north` instead of `minLon/minLat/maxLon/maxLat` in catalog/search
- `updated.catalogId` before `updated` is assigned (should be `row.catalogId` or `catalogId`)
- `.set({ folderId })` in the retry route (should be `{ status: "processing", errorMessage: null, datasetId: null }`)
- `.set({ folderId })` in the rename route (should be `{ displayLabel }`)
- `eq(table.id, saveId)` in GET /my-saves where `saveId` is not in scope (should filter by `userId` only)

Also check test files: `select: plainFn` in a `createDbMock` override fails `MockInstance` type — wrap in `vi.fn()`.

- Damage can also appear as hunks transplanted into the WRONG handler (e.g. an `.set({...})` payload swapped between routes, a where-clause borrowed from a different endpoint) — not just dropped wrappers. Repair by restoring the file from the merge baseline (`git show <baseline>:path > path`) and re-applying only your deliberate edits; do not patch the scrambled file in place.

**Update (rebase auto-merge, markers.ts):** the task-rebase structural merger (S+F conflict hints) can silently corrupt handlers OUTSIDE the marked conflict region — duplicated `const` lines, swapped query bodies between routes (GET standard-mode got the bounds-mode where-clause), and dropped guard blocks. After resolving marked conflicts, always diff the whole file against main's version and run the route's unit suite before finishing; the committed squash can contain corruption even when `continueMergeResolution` reports success.

## Test files get hit too (2026-08-17)

The same damage pattern also lands in test files, not just route files: a merge
dropped a `vi.mock()` factory's `return {...}` block plus the 4-line component
import block that followed it, splicing the next hunk's stray line
(`const EMPTY = new Map();`) into the truncated mock body. Detector: `tsc`
fails with TS1005 "'}' expected" at EOF (unbalanced braces). Repair the same
way: `git diff <last-good> HEAD -- <file>` shows the dropped hunk verbatim —
restore it rather than rewriting. Raw brace-counting is misleading (braces in
strings/regexes); trust tsc, not counts. Sibling symptom in the same batch of
merges: unused-import TS6133 errors (`beforeEach` imported, never used).
