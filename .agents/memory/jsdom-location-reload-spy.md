---
name: JSDOM location reload spying
description: Testing browser reload handlers when JSDOM exposes a non-redefinable Location method.
---

JSDOM's `window.location.reload` cannot be redefined with `vi.spyOn`; stub the global `window` with a replacement `location.reload` before invoking the handler, then restore global stubs.

**Why:** JSDOM defines the Location method as non-configurable, so direct spies fail before the behavior under test runs.

**How to apply:** Use this pattern for unit tests that need to assert a reload callback without navigating or emitting JSDOM's not-implemented error.