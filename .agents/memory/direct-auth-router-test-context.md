---
name: Direct auth-router test context
description: How isolated API route tests should provide Clerk context when exercising the real requireAuth middleware.
---

When a route test mounts a router directly instead of the full API app, mock Clerk's `getAuth` result explicitly before importing the router. Use the E2E bypass headers for authenticated cases and return `{ userId: null }` for the unauthenticated case.

**Why:** `requireAuth` normally runs after the app-level Clerk middleware has attached request context. Without that outer middleware, the real `getAuth(req)` helper can throw instead of reaching the route's intended 401 response.

**How to apply:** Any focused test that mounts an auth-protected router directly should provide a small `@clerk/express` mock while preserving the production `requireAuth` implementation.