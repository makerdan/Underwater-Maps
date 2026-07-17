---
name: vi.hoisted required for mock vars read at module init
description: When a vi.mock() factory closure reads a variable that uiStore.ts (or any eagerly-initializing module) reads at import time, plain `let` causes a TDZ crash. Use vi.hoisted() instead.
---

# vi.hoisted required for mock vars accessed at module init

## The rule
Any mutable variable that both:
1. Is captured by a `vi.mock()` factory closure, **and**
2. Is read during module initialization of an imported module (not just inside test callbacks)

…must be declared with `vi.hoisted()`, not plain `let`.

**Why:** Vitest hoists `vi.mock()` factories to before the `let` declarations. ESM imports are also resolved before the module body runs. So when an imported module calls `useSettingsStore.getState()` at init time (e.g. `uiStore.ts:608`), the factory closure executes `settingsState()` which reads a `let` variable that is still in the Temporal Dead Zone — crash.

## How to apply
Replace:
```typescript
let mockFoo = true;

vi.mock("@/lib/someStore", () => {
  const state = () => ({ foo: mockFoo });
  ...
});
```

With:
```typescript
const h = vi.hoisted(() => {
  let _foo = true;
  return {
    get foo() { return _foo; },
    set foo(v: boolean) { _foo = v; },
  };
});

vi.mock("@/lib/someStore", () => {
  const state = () => ({ foo: h.foo });
  ...
});

// In tests: h.foo = false; instead of mockFoo = false;
```

## Affected file
`artifacts/bathyscan/src/components/__tests__/CurrentsPanel.advanced.test.tsx` — fixed this way. The uiStore.ts:608 call chain: `CurrentsPanel.tsx:26 → uiStore.ts:608 → useSettingsStore.getState() → settingsState()`.
