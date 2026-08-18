/**
 * Site-status gate.
 *
 * `VITE_SITE_STATUS=closed` (build-time env var) puts the app into
 * "closed for private testing" mode:
 *   - the landing page shows the ClosedForTestingBanner,
 *   - the "Create account" button is omitted, and
 *   - the /sign-up route redirects back to the landing page.
 *
 * Any other value — or the variable being absent — means the site is open
 * and nothing changes. This lets the admin flip the site open with an env
 * change + rebuild, no code deploy.
 *
 * Exposed as a function (evaluated at call time) rather than a module-level
 * constant so unit tests can flip the flag with `vi.stubEnv()` without
 * resetting the module registry.
 */
export function isSiteClosed(): boolean {
  return import.meta.env.VITE_SITE_STATUS === "closed";
}
