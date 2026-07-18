/**
 * Single source of truth for the deliberately fixed E2E ports.
 *
 * These are the ONLY places in the repository where a port number literal
 * may appear (enforced by `scripts/check-hardcoded-ports.mjs`, which
 * allowlists this file). Every consumer — the Playwright config, its
 * webServer commands, and any test code — must import from here instead of
 * inlining port literals.
 *
 * All values are env-overridable so CI or a local run can relocate the
 * suite without code changes:
 *   - E2E_WEB_PORT          (bathyscan Vite dev server; default 3150)
 *   - E2E_API_PORT          (api-server E2E instance;   default 3161)
 *   - E2E_BUNDLE_TEST_PORT  (dummy PORT for config-only builds; default 4173)
 */

function envPort(name: string, defaultPort: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultPort;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(
      `Invalid ${name} value: "${raw}" (expected an integer between 1 and 65535)`,
    );
  }
  return parsed;
}

/** Port the bathyscan frontend dev server listens on during E2E runs. */
export const E2E_WEB_PORT = envPort("E2E_WEB_PORT", 3150);

/** Port the api-server E2E instance listens on during E2E runs. */
export const E2E_API_PORT = envPort("E2E_API_PORT", 3161);

/**
 * Dummy PORT used when a Vite config must be loaded for a build-only
 * operation (the config hard-throws without PORT, but no server ever
 * binds it during `vite build`).
 */
export const E2E_BUNDLE_TEST_PORT = envPort("E2E_BUNDLE_TEST_PORT", 4173);

/**
 * Per-run output directory for the api-server E2E build, keyed by the API
 * port so parallel e2e runs (e.g. the main suite on the default ports and
 * the palette suite on relocated ports) never race on the same dist folder.
 * The default-port run keeps the historical "dist-e2e" name.
 */
export const E2E_DIST_DIR =
  process.env["E2E_DIST_DIR"] ??
  (E2E_API_PORT === 3161 ? "dist-e2e" : `dist-e2e-${E2E_API_PORT}`);

/**
 * Per-run identity suffix, keyed by the API port the same way E2E_DIST_DIR
 * is. Parallel e2e runs must not share server-side user rows (settings,
 * onboarding flags, datasets) or one run's writes clobber the other's
 * assertions mid-test. The default-port run keeps the historical bare
 * identity (empty suffix).
 */
export const E2E_RUN_SUFFIX = E2E_API_PORT === 3161 ? "" : `-${E2E_API_PORT}`;

/** Base URL of the bathyscan frontend during E2E runs. */
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;

/** Base URL of the api-server during E2E runs (IPv4-pinned; see api-server). */
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
