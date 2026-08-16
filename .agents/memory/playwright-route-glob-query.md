---
name: Playwright route glob vs query strings
description: page.route glob patterns silently stop matching when the client adds a query param to an existing endpoint
---

# Playwright route glob vs query strings

**Rule:** `page.route("**/api/foo", ...)` matches the full URL including the query
string. If a client change adds a query param (e.g. `?waterType=saltwater`) to a
previously bare fetch, every e2e spec that mocks the endpoint with a bare glob
silently stops intercepting — the request falls through to the real server and the
spec fails in confusing ways.

**Why:** Playwright glob matching is against the entire URL; `*` does not cross `/`
but does match `?query=...`.

**How to apply:** Whenever a client-side change adds or changes query params on an
existing API call, grep `tests/e2e` for `page.route` patterns that end at that
path and append `*` (e.g. `"**/api/datasets/my-saves*"`). The suffix `*` will not
over-match subpaths like `/my-saves/:id/...` because `*` stops at `/`.
