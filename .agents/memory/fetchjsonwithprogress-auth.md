---
name: fetchJsonWithProgress auth wiring
description: fetchJsonWithProgress now attaches the Clerk Bearer token automatically via getAuthToken(); caller headers override it. Do not re-inject tokens manually.
---

## The rule

`fetchJsonWithProgress` (artifacts/bathyscan/src/lib/fetchWithProgress.ts) calls `getAuthToken()` from `@workspace/api-client-react` itself and injects `Authorization: Bearer <token>` on every request when a token getter is registered. Caller-supplied `init.headers` take precedence over the injected header. Callers must NOT manually wire the token — that would be double-wiring.

**Why:** It previously used raw `fetch` with no token; `makeProgressTerrainFetcher` in DatasetPanel patched around it manually, and other callers silently got 401s on `requireAuth` routes (terrain/overview loads failed while signed in). Cookie auth is intentionally disabled in BathyScan (Clerk's handshake 307 breaks in Replit's proxied iframe), so the Bearer header is the only auth path.

**How to apply:** New `fetchJsonWithProgress` callers on authed routes need nothing extra. For any other raw fetch against a `requireAuth` route, use `authorizedFetch` (artifacts/bathyscan/src/lib/authorizedFetch.ts) — it does the same token wiring; caller headers win. Watch out: `GET /api/datasets/:id/zones` looks public but is conditionally auth-required (preset IDs public, UUID/upload IDs need auth) — audit route handlers for inline `getAuth` checks, not just `requireAuth` middleware. All raw call sites were migrated; the only remaining gap is the service worker's background marker sync (sw.ts), which cannot reach the token getter and is documented as best-effort (page-side offlineFlush retries with the token). Signed-out is safe: `getAuthToken()` returns null → no header. Test gotcha: because `getAuthToken()` adds an async tick before `fetch`, fetch mocks in abort tests must handle an already-aborted signal (`init?.signal?.aborted`), not just listen for the abort event.
