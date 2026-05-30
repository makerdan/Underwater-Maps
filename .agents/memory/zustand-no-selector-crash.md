---
name: Zustand no-selector crash
description: Calling any Zustand store without a selector (or with a selector that returns a new object/array literal) causes "getSnapshot should be cached" infinite loop in React 18 Concurrent Mode
---

## Rule
Never call any Zustand store without a selector, and never return a new object or array literal from a selector. Always use per-field selectors returning primitives or stable references.

```ts
// WRONG — subscribes to entire state object
const { driftPlannerActive } = useDriftStore();

// WRONG — selector returns a new [] on every call when field is empty
const items = useSettingsStore((s) => s.items[id] ?? []);

// CORRECT — per-field primitive selector
const driftPlannerActive = useDriftStore((s) => s.driftPlannerActive);

// CORRECT — stable fallback reference defined at module scope
const EMPTY: Foo[] = [];
const items = useSettingsStore((s) => s.items[id] ?? EMPTY);
```

**Why:** React 18 Concurrent Mode calls `useSyncExternalStore`'s `getSnapshot` twice per render pass. If consecutive calls return different references (a new `[]` or `{}` literal, or the whole store state when any field changes), React logs "getSnapshot should be cached" → infinite re-render → "Maximum update depth exceeded." Per-field selectors returning primitives, or selectors using stable module-level fallbacks, pass `Object.is` comparison safely.

**How to apply:** When adding any component that reads from a Zustand store: use a selector, and if the selector might return an array/object fallback, define that fallback as a module-level constant (not an inline literal).

**Remaining known risk:** `src/pages/Settings.tsx` has 14 `useSettingsStore()` calls without selectors (Settings route only, not main app path). Lower risk because settings page is visited after auth/hydration completes, but could still crash if settings store updates during a concurrent render on that route.
