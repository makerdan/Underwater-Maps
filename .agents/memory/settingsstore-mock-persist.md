---
name: settingsStore mock must include persist+setState
description: When mocking @/lib/settingsStore in vitest, must include persist, setState, getState, and subscribe on the useSettingsStore mock function or uiStore.ts crashes at module init and during action handlers.
---

## Rule

Any vitest mock of `@/lib/settingsStore` that overrides `useSettingsStore` must:
1. Use `importOriginal` and spread `actual` to preserve `DEFAULT_SETTINGS` and other exports.
2. Build the mock store with `Object.assign` and attach: `getState`, `setState`, `persist`, `subscribe`.

```ts
vi.mock("@/lib/settingsStore", async (importOriginal) => {
  const actual = await importOriginal();
  const storeState = { waterType: "salt" /* ... */ };
  const useSettingsStore = Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    {
      getState: () => storeState,
      setState: vi.fn(),
      persist: { hasHydrated: () => false, onFinishHydration: () => () => {} },
      subscribe: () => () => {},
    },
  );
  return { ...actual, useSettingsStore };
});
```

**Why:** `uiStore.ts` runs top-level module code that calls `useSettingsStore.persist.hasHydrated()` on import. It also calls `useSettingsStore.setState(...)` inside action handlers (`toggleEfhSpecies`, `setIntertidalScoreMode`) triggered by user interaction in tests. Missing either causes `TypeError: Cannot read properties of undefined`.

**How to apply:** Every time a test mocks `@/lib/settingsStore` with a custom `useSettingsStore` function, apply this pattern. Use `hasHydrated: () => false` to skip the initial `applySettingsToUiStore` call (avoids needing a full settings state). `setState: vi.fn()` prevents crashes when actions write back to the settings store.
