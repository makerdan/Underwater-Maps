import { test } from "@playwright/test";
import { E2E_API_URL } from "./ports";

/**
 * Post-startup liveness probe for the API server.
 *
 * Playwright's webServer.url healthcheck confirms the server came up once
 * before any project runs. The gap it leaves is the "server started, passed
 * the one-time check, then crashed" scenario — all ~400 e2e tests would then
 * run against a dead process and produce cascade failures that look like
 * real product regressions.
 *
 * This setup project fills that gap: it polls /api/healthz several times
 * after webServer starts to confirm the server is still alive and stable.
 * Because all other projects declare `dependencies: ["setup"]`, Playwright
 * skips them entirely when this test fails — producing a single clear
 * diagnostic that names the API server as the root cause instead of hundreds
 * of misleading spec failures.
 */

const HEALTHZ_URL = `${E2E_API_URL}/api/healthz`;
const POLL_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 1_000;

test("api-server liveness: /api/healthz stable after startup", async ({ request }) => {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt++) {
    let status: number;
    try {
      const resp = await request.get(HEALTHZ_URL, { timeout: 5_000 });
      status = resp.status();
    } catch (err) {
      throw new Error(
        `[e2e liveness] API server unreachable at ${HEALTHZ_URL} ` +
          `(attempt ${attempt}/${POLL_ATTEMPTS}).\n` +
          `Root cause: the api-server process crashed or failed to start.\n` +
          `Check the webServer stderr output above for startup errors.\n` +
          `Original error: ${(err as Error).message}`,
      );
    }

    if (status !== 200) {
      throw new Error(
        `[e2e liveness] API server returned HTTP ${status} (expected 200) ` +
          `at ${HEALTHZ_URL} (attempt ${attempt}/${POLL_ATTEMPTS}).\n` +
          `The api-server process may have crashed after its initial healthcheck passed.\n` +
          `Check the webServer stderr output above for errors.`,
      );
    }

    if (attempt < POLL_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
});
