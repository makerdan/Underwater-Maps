---
name: Playwright route glob vs query strings
description: page.route glob patterns silently stop matching when the client adds a query param to an existing endpoint
---

# Playwright route glob vs query strings

**Rule:** `page.route` globs match the full URL. A trailing `*` matches query
strings but not `/` path segments: use `"**/api/foo*"` for an endpoint plus
query, and `"**/api/foo/*"` for a child path such as `/foo/:id`.
If a route mock uses the wrong shape, the request silently falls through to the
real server and the spec fails in confusing ways.

**Why:** Playwright glob matching is against the entire URL; `*` does not cross `/`
but does match `?query=...`.

**How to apply:** Choose the route glob based on the URL shape, and register
separate endpoint and child-path handlers when both are needed. For query
params, append `*` (e.g. `"**/api/datasets/my-saves*"`); for nested paths, put
the slash and segment wildcard in the pattern (e.g.
`"**/api/user/collections/*/meta"`).
