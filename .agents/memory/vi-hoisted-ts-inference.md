---
name: vi.hoisted TS inference gap
description: vi.hoisted() destructured variables fail TS2304 "Cannot find name" in workspace-level typecheck even when local tsc passes; use plain module-level objects instead.
---

# vi.hoisted TypeScript inference gap

## The rule
Do NOT use `const { foo } = vi.hoisted(() => ({ foo: ... }))` when `foo` needs to be referenced inside a `vi.mock()` factory closure. The workspace-level pnpm typecheck (`tsc --build` or `pnpm -r run typecheck`) will emit TS2304 "Cannot find name 'foo'" at the call sites even though `cd <pkg> && tsc --noEmit` passes locally. This discrepancy is caused by how the workspace typecheck resolves module scope vs. how local tsc uses cached `.tsbuildinfo`.

## Why
`vi.hoisted()` returns a value whose type TypeScript can only infer through a generic. When the workspace typecheck runs across packages simultaneously (pnpm -r parallel mode), the inference chain sometimes fails and produces an `any` or unresolved type, causing TS2304 at use sites.

## How to apply
For any test recorder or spy that must be accessible from inside a `vi.mock()` factory:
- Declare it as a plain module-level `const` or `let` (no `vi.hoisted`)
- This is the same pattern as `vi.fn()` spies (`const invalidateQueriesSpy = vi.fn()`) which always work
- Example:
  ```ts
  let _useQueryCalls: unknown[] = [];
  const useQueryRecorder = {
    get calls(): unknown[] { return _useQueryCalls; },
    fn(opts: unknown) { _useQueryCalls.push(opts); return { data: undefined, isLoading: false }; },
    clear() { _useQueryCalls = []; },
  };
  ```
- Then reference `useQueryRecorder` directly inside the `vi.mock(() => ({ useQuery: (o) => useQueryRecorder.fn(o) }))` factory.
