---
name: Mobile Playwright GPU crash
description: Pixel-device Playwright runs may be blocked by host Chromium GPU/V8 crashes rather than app behavior.
---

Mobile Playwright emulation is not evidence of a product failure when the
host's Chromium repeatedly exits with `GPU process isn't usable` or
`Error loading V8 startup snapshot file` before a stable browser context exists.

**Why:** On this host, a Pixel 7 project launched the API and web servers but
Chromium crashed before authenticated mobile assertions could run.

**How to apply:** Record mobile browser journeys as environment-limited and
rerun on a stable Chromium/CI host before classifying mobile behavior.