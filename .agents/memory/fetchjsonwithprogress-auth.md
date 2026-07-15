---
name: fetchJsonWithProgress auth wiring
description: fetchJsonWithProgress now attaches the Clerk Bearer token automatically via getAuthToken(); caller headers override it. Do not re-inject tokens manually.
---

## The rule

`fetchJsonWithProgress` (artifacts/bathyscan/src/lib/fetchWithProgress.ts) calls `getAuthToken()` from `@workspace/api-client-react` itself and injects `Authorization: Bearer <token>` on every request when a token getter is registered. Caller-supplied `init.headers` take precedence over the injected header. Callers must NOT manually wire the token — that would be double-wiring.

**Why:** It previously used raw `fetch` with no token; `makeProgressTerrainFetcher` in DatasetPanel patched around it manually, and other callers silently got 401s on `requireAuth` routes (terrain/overview loads failed while signed in). Cookie auth is intentionally disabled in BathyScan (Clerk's handshake 307 breaks in Replit's proxied iframe), so the Bearer header is the only auth path.

**How to apply:** New `fetchJsonWithProgress` callers on authed routes need nothing extra. Signed-out is safe: `getAuthToken()` returns null → no header. Test gotcha: because `getAuthToken()` adds an async tick before `fetch`, fetch mocks in abort tests must handle an already-aborted signal (`init?.signal?.aborted`), not just listen for the abort event.
