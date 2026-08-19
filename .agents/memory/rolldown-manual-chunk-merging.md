---
name: Rolldown manual-chunk dependency merging
description: Why manually grouping React Three packages can defeat a lazy scene boundary in Vite 8/Rolldown.
---

Do not assume a manual chunk containing `@react-three/fiber` and
`@react-three/drei` remains dynamic just because the scene importing them is
lazy. Under Vite 8/Rolldown, a shared static dependency on `three` can cause the
manually grouped renderer packages and Three itself to be emitted as one chunk,
which then appears in the entry's module-preload/static dependency closure.

**Why:** A lazy scene facade and sensible-looking chunk name both passed review
while Fiber/Drei were still fetched initially. Separating only the `three`
package and letting Rolldown keep Fiber/Drei with the lazy scene preserved the
actual runtime boundary.

**How to apply:** For future renderer splitting, inspect emitted chunk
`moduleIds` and recursively walk the entry chunk's `imports`. Assert that chunks
containing Fiber/Drei modules are outside that static closure. Treat chunk names
and facade-level dynamic-import checks as insufficient evidence.