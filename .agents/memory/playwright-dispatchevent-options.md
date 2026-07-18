---
name: Playwright dispatchEvent arg order
description: locator.dispatchEvent timeout must go in the THIRD argument, not the second.
---

`locator.dispatchEvent(type, eventInit, options)` — the second argument is the
event init dict, the third is options. Passing `{ timeout: 3000 }` as the second
argument silently treats it as eventInit and the call waits for element
attachment until the TEST timeout (60 s hang) when the element never exists.

**Why:** an offline-badges spec hung 60 s because the "expand folder" click used
`.dispatchEvent("click", { timeout: 3000 })` on a button absent from an empty
dataset list.

**How to apply:** for optional/possibly-absent elements use
`.dispatchEvent("click", undefined, { timeout: 3_000 }).catch(() => {})`.
Also useful: React `onMouseEnter` can be triggered headlessly with
`.dispatchEvent("mouseover", { bubbles: true })` when real `.hover()` is
intercepted by overlapping chrome.
