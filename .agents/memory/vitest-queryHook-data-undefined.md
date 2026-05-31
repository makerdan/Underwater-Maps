---
name: vitest queryHook must return data:undefined
description: Why inline API mock queryHook stubs must return data:undefined, not data:[]
---

# queryHook must return `data: undefined`, not `data: []`

## The Rule
Every inline `queryHook` stub in a Vitest API-client mock must return
`{ data: undefined, ... }`, never `{ data: [], ... }`.

## Why
Returning `data: []` creates a new array reference on every `queryHook()`
call. Components that have a `useEffect([data])` which accumulates pages
(e.g. `FindDataPanel`'s NCEI section does `setNceiAccumulated(nceiPage)`)
will:
1. See `nceiPage` as a new reference every render.
2. Execute the effect → call `setState` → trigger a re-render.
3. Repeat indefinitely — `act()` in React Testing Library waits for effects
   to settle and **never returns**, hanging the test.

Note: this is *not* the same as React's "Maximum update depth exceeded"
(which fires for render-phase setState). `setState` from `useEffect` loops
do not hit that guard; they just run forever in `act()`.

## How to apply
- Any test file that defines its own proxy factory (`vi.hoisted(() => { function queryHook() { ... } })`): ensure `queryHook` returns `data: undefined`.
- The canonical copy in `src/__tests__/apiClientMock.ts` already does this correctly.
- Explicit per-hook overrides in `makeApiClientMock({...})` may still return `data: []` where the component destructures with a default (`= []`).

## Companion issue
`@radix-ui/react-compose-refs@1.1.2` + React 19 creates a render-phase
ref-callback loop when many sibling `<Tooltip>` instances exist (e.g.
`FindDataPanel`'s 7 chip-filter buttons each wrapped in `<ViewscreenTooltip>`).
Fix: mock `@/components/ViewscreenTooltip` to `({ children }) => children`
in any test that renders `FindDataPanel`.
