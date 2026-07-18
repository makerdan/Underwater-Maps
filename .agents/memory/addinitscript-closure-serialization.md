---
name: Playwright addInitScript closure serialization
description: Functions passed to addInitScript must not close over outer variables — pass values as the second argument
---
Playwright serializes only the function *source* for `page.addInitScript(fn)`. A function returning or using a closure over an outer variable (e.g. `value`) becomes a ReferenceError in the browser; if the body wraps writes in try/catch, the seed silently never lands and the test's starting state becomes a hydration race.

**How to apply:** always pass data explicitly: `page.addInitScript(fn, value)` where `fn(value)` takes it as a parameter and references nothing outside its own scope. Suspect this whenever a localStorage seed "doesn't take" in e2e tests.
