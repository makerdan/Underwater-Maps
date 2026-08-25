---
name: Sidebar responsive CSSOM expectation
description: The wide sidebar min-width test expects CSSOM to resolve a CSS-inch expression that current jsdom preserves as a calc-like min expression.
---

The responsive sidebar width test can fail deterministically because the test environment preserves `min(736px, -32px + 100vw)` instead of exposing the expected `712px` conversion; this is unrelated to Plan tool content.

**Why:** The same assertion failed on three isolated retries while the adjacent sidebar tests passed.

**How to apply:** Classify this as a pre-existing validation failure unless the sidebar sizing expression or test environment changes.