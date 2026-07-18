---
name: Express 5 wildcard routes
description: path-to-regexp v8 (Express 5) rejects bare "*" route patterns
---

Rule: In Express 5 (path-to-regexp v8), a route like `router.get("/objects/*")` throws at registration time ("Missing parameter name"). Wildcards must be named: `"/objects/*objectPath"`.

**Why:** The catch-photo objects route crashed test collection (and would crash the server at import) with an opaque path-to-regexp stack until the wildcard was renamed.

**How to apply:** Any new catch-all/static-file route in api-server must use a named splat (`*name`); `req.path` still contains the full path for downstream use.
