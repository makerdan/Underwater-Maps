/**
 * Dev-only frontend auth bypass.
 *
 * When `VITE_DEV_AUTH_BYPASS=1` is set AND the build is a Vite dev build
 * (`import.meta.env.DEV === true`), the app behaves as if a fake "Dev User"
 * is signed in: Clerk is shimmed out, the sign-in gate is skipped, and API
 * calls carry the `x-e2e-user-id` header the API server's existing
 * `E2E_AUTH_BYPASS` middleware accepts.
 *
 * Hard gates:
 *   - `import.meta.env.DEV` short-circuits the env-var read in production
 *     builds, so the bypass branch is dead code and tree-shaken away.
 *   - `assertDevAuthBypassSafe()` throws at startup if the flag is somehow
 *     truthy outside DEV mode.
 *
 * To use locally:
 *   1. In `artifacts/bathyscan/.env.local`, set `VITE_DEV_AUTH_BYPASS=1`.
 *   2. In the api-server env, set `E2E_AUTH_BYPASS=1`.
 *   3. Restart both workflows.
 *
 * The fake user id is stable (`dev-user-bypass`) so server-side rows
 * created during a bypass session can be cleaned up predictably.
 */

// Overridable per e2e suite (VITE_E2E_USER_ID) so two concurrently running
// Playwright suites (e.g. the full run and the palette run) do not share the
// same server-side settings rows and clobber each other's PUT /api/settings.
// Dev-only: import.meta.env reads are DCE'd out of production builds along
// with the rest of the bypass machinery.
export const FAKE_DEV_USER_ID: string =
  (import.meta.env.DEV && import.meta.env.VITE_E2E_USER_ID) || "dev-user-bypass";

export const FAKE_DEV_USER = {
  id: FAKE_DEV_USER_ID,
  username: "dev-user",
  primaryEmailAddress: { emailAddress: "dev-user@bathyscan.local" },
  emailAddresses: [{ emailAddress: "dev-user@bathyscan.local" }],
  fullName: "Dev User",
  firstName: "Dev",
  lastName: "User",
} as const;

export const DEV_AUTH_BYPASS: boolean =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "1";

export function assertDevAuthBypassSafe(): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "1") {
    throw new Error(
      "[bathyscan] VITE_DEV_AUTH_BYPASS=1 was set in a non-dev build. " +
        "This flag is dev-only and must never ship to production.",
    );
  }
  // The explicit import.meta.env.DEV guard lets Vite tree-shake this entire
  // branch (including the console.warn call) from production bundles, even
  // though DEV_AUTH_BYPASS already incorporates the same flag.
  if (import.meta.env.DEV && DEV_AUTH_BYPASS && typeof console !== "undefined") {
    console.warn(
      "%c[bathyscan] DEV AUTH BYPASS ACTIVE — Clerk is stubbed, requests are signed as " +
        FAKE_DEV_USER_ID +
        ". Never enable in production.",
      "background:#7f1d1d;color:#fee2e2;padding:2px 6px;border-radius:3px;font-weight:bold;",
    );
  }
}

/**
 * Patch `window.fetch` so every same-origin `/api/*` request carries the
 * `x-e2e-user-id` header. Only installed when `DEV_AUTH_BYPASS` is true.
 *
 * This piggybacks on the api-server's existing `E2E_AUTH_BYPASS` path so
 * we don't have to weaken the production auth middleware.
 */
export function installDevAuthFetchPatch(): void {
  if (!DEV_AUTH_BYPASS) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const original = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(
      init?.headers ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.headers
          : undefined),
    );
    if (!headers.has("x-e2e-user-id")) {
      headers.set("x-e2e-user-id", FAKE_DEV_USER_ID);
    }
    return original(input, { ...(init ?? {}), headers });
  }) as typeof window.fetch;
}
