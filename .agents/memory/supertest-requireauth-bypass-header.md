---
name: supertest requireAuth bypass header
description: Test apps mounting requireAuth-guarded routers must inject x-e2e-user-id or every request 500s
---

Rule: any supertest `express()` app that mounts a router using `requireAuth` must set the
`x-e2e-user-id` header (plus `E2E_AUTH_BYPASS=1`) — e.g. an app-level middleware
`req.headers["x-e2e-user-id"] = "test-user"` before the router.

**Why:** without the bypass header, requireAuth falls through to Clerk's `getAuth(req)`,
which throws when no clerkMiddleware is mounted — every request 500s before reaching the
handler, so all status-code assertions fail with "expected 500 to be …".

**How to apply:** when a new route test file returns 500 for everything despite correct
mocks, check the auth header first. Also: validation middleware error code standard is
`error: "invalid_request"` (not `invalid_param`).
