---
name: API route test mock fallback
description: Route tests need complete fallback mocks because app.ts mounts every router during module initialization.
---

Route tests that mock `@workspace/api-zod` or `@workspace/db` should wrap their
stateful overrides in a complete-export fallback. New route imports otherwise
crash unrelated tests during app initialization before the suite can collect.

**Why:** Adding a route or generated schema changes the app-wide import surface,
while individual route tests only exercise a small subset of that surface.

**How to apply:** Preserve test-specific stateful implementations, but use a
Proxy fallback for missing schema/table exports and keep a static route-import
drift check in the fast validation tier.