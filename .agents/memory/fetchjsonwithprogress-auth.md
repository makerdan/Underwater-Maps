---
name: fetchJsonWithProgress missing Bearer token
description: fetchJsonWithProgress does not attach Authorization headers — callers on authed routes must inject the token manually via init.headers.
---

## The rule

`fetchJsonWithProgress` uses `credentials: "same-origin"` (cookies) and accepts an optional `init: RequestInit` spread, but never calls `getAuthToken()` itself. In BathyScan, cookie-based auth is intentionally disabled (Clerk's handshake 307 redirects break in Replit's proxied-iframe). All auth flows through `customFetch`, which reads `_authTokenGetter`.

Any function that calls `fetchJsonWithProgress` for an authenticated route **must** resolve the token explicitly and pass it in `init.headers`:

```ts
const token = await getAuthToken();
const headers: Record<string, string> = token
  ? { Authorization: `Bearer ${token}` }
  : {};
fetchJsonWithProgress(url, { signal, init: { headers }, ... });
```

**Why:** `makeProgressTerrainFetcher` in DatasetPanel.tsx overrides the TanStack-generated queryFn with a streaming fetcher to drive the loading-progress dial. Because it bypassed `customFetch`, `/api/user/datasets/:id/terrain` and `/api/user/datasets/:id/overview` received requests with no Authorization header → `getAuth(req)?.userId` was null → 401. The list endpoint `/api/user/datasets` was fine because it used the generated hook without a custom queryFn.

**How to apply:** Whenever adding a new call to `fetchJsonWithProgress` for a route protected by `requireAuth`, wrap it as above. If the route is public, no token is needed (getAuthToken returns null → no header added, which is also safe).
