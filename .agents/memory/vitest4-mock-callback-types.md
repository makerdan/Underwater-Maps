---
name: Vitest 4 mock callback typing
description: Explicitly type vi.fn implementations and fetch spy call tuples after the Vitest 4 type update.
---

# Vitest 4 mock callback typing

**Rule:** Give mocks passed or invoked as ordinary callbacks an explicit implementation signature (for example, `vi.fn((): void => {})` or `vi.fn(async (): Promise<void> => {})`). When reading `vi.spyOn(globalThis, "fetch").mock.calls`, cast the recorded calls to `Parameters<typeof globalThis.fetch>[]` before mapping or filtering.

**Why:** Vitest 4's default mock type can be `Mock<Procedure | Constructable>`, which is not assignable to a plain callback and may not be callable. Spy call arrays can also lose callback parameter inference. These errors stop workspace typecheck before any unit or browser suite starts.

**How to apply:** After a Vitest upgrade, typecheck tests that pass untyped `vi.fn()` values across callback boundaries or inspect spy call arguments. Add narrow function signatures rather than using `any`.