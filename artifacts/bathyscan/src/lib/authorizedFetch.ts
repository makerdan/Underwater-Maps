/**
 * authorizedFetch — drop-in `fetch` wrapper for raw calls to API routes
 * protected by `requireAuth` on the server.
 *
 * The generated API client (customFetch) attaches the Clerk Bearer token
 * automatically, but raw `fetch` calls bypass that wiring and silently 401
 * for signed-in users. Every raw fetch against an authenticated route must
 * go through this helper (or fetchJsonWithProgress, which does the same).
 *
 * Behaviour:
 * - Resolves the current Clerk token via getAuthToken() (the getter wired by
 *   ClerkAuthTokenWirer in App.tsx) and attaches `Authorization: Bearer …`.
 * - Caller-supplied headers take precedence — an explicit Authorization
 *   header in `init.headers` is never overwritten.
 * - Defaults `credentials` to "include" so the cookie-session path keeps
 *   working; callers may override via `init.credentials`.
 * - When no token getter is registered (tests, signed-out) the request is
 *   sent without an Authorization header, matching plain fetch.
 */
import { getAuthToken } from "@workspace/api-client-react";

export async function authorizedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init.headers ?? {});
  if (token && !headers.has("authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, {
    credentials: "include",
    ...init,
    headers,
  });
}
