---
name: Playwright contextmenu dispatchEvent drops coordinates
description: Why locator.dispatchEvent("contextmenu", {clientX,...}) silently loses mouse coordinates in e2e tests
---
Playwright's `locator.dispatchEvent("contextmenu", { clientX, clientY })` constructs a plain `Event` — "contextmenu" is not in Playwright's MouseEvent type map — so clientX/clientY are silently dropped and arrive as `undefined` (NaN after arithmetic) in the handler.

**Why:** The overview-map right-click e2e tests intermittently "passed" with NaN coordinates because `expect.any(Number)` matches NaN; the Place-marker test skipped instead of failing. The handler now guards non-finite lon/lat and returns without opening the menu.

**How to apply:** To synthesize a right-click with real coordinates on a covered/overlapped element, use `locator.evaluate((el, init) => el.dispatchEvent(new MouseEvent("contextmenu", init)), {...})` instead of `dispatchEvent`. Same caveat likely applies to any event type outside Playwright's known type map. Also note `expect.any(Number)` matches NaN — assert `Number.isFinite` when coordinates matter.
