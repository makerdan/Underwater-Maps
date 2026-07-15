import { defineConfig, devices } from "@playwright/test";
import budgets from "./tests/timeout-guard/budgets.json";
import {
  E2E_WEB_PORT,
  E2E_API_PORT,
  E2E_WEB_URL,
  E2E_API_URL,
} from "./tests/e2e/ports";

export default defineConfig({
  globalSetup: "./tests/e2e/global-setup.ts",
  testDir: "./tests/e2e",
  // Layers 1+2: explicit per-test and per-expect timeouts from the shared
  // budget config (tests/timeout-guard/budgets.json) — no silent framework
  // defaults. Layer 3 (per-file budget) lives in tests/e2e/fixtures.ts;
  // Layer 4 (whole-run budget) is enforced both here (globalTimeout) and by
  // the run-with-timeout wrapper around `pnpm run test:e2e`.
  timeout: budgets.e2e.testTimeoutMs,
  expect: { timeout: budgets.e2e.expectTimeoutMs },
  globalTimeout: budgets.e2e.runBudgetMs,
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  // Per-test retries. Stabilizes the suite against rare timing flakes
  // (terrain race, network jitter on tide/NOAA, debounced settings sync)
  // without masking genuine product regressions: a test that fails twice
  // in a row still fails. CI uses 2 retries for headroom under load.
  retries: process.env["CI"] ? 2 : 1,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? E2E_WEB_URL,
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env["REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE"],
          // Enable software-rendered WebGL (SwiftShader via ANGLE) inside
          // headless Chromium so the real Three.js Canvas can initialise a
          // WebGL2 context. With these flags off, headless Chromium hands
          // back a stub and three.js throws "Error creating WebGL context",
          // which forces every canvas-gated e2e spec to bypass the 3D
          // scene via the dev-only `__bathyTest` helper rig.
          //
          // NOTE (Replit caveat): the Replit-managed Chromium build's GPU
          // process currently crashes on this host before swiftshader can
          // attach (exit_code=11 from gpu_process_host.cc). Until that's
          // resolved at the platform level, `tests/e2e/webgl-smoke.spec.ts`
          // detects WebGL availability at runtime and skips with a clear
          // message instead of hard-failing. These flags are still the
          // correct, future-proof configuration and take effect in any CI
          // environment whose Chromium GPU process can start.
          //
          // To keep the rest of the suite from silently no-op'ing on the
          // same hosts, `TourScene` ships a dev+e2e-only fallback: when
          // VITE_DEV_AUTH_BYPASS=1 and WebGL is unavailable it renders a
          // stub <canvas data-engine="three.js stub-no-webgl"> in place of
          // the R3F Canvas. The `canvas[data-engine^="three.js"]` locator
          // used by every canvas-gated spec still matches, so the specs
          // continue past the visibility gate and drive scene state via
          // the dev-only `__bathyTest` helper rig (which mutates the
          // relevant Zustand stores directly and doesn't need a live R3F
          // raycaster). Both guards are dev-only and Vite-DCE'd out of
          // production bundles, so the fallback can never ship.
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--enable-features=Vulkan",
          ],
        },
      },
    },
  ],
  // Start both the api-server (with dev-only auth bypass enabled) and the
  // bathyscan frontend (with the corresponding header-injection bypass).
  // The frontend proxies `/api/*` to the api-server so the React app can
  // exercise real auth-gated routes end-to-end.
  webServer: [
    {
      // ORDERING CONTRACT: globalSetup (above) always runs before Playwright
      // starts any webServer process. global-setup.ts calls `node ./build.mjs`
      // with DIST_DIR=dist-e2e, ensuring dist-e2e/index.mjs exists before
      // `start:e2e` is invoked. Do not remove or move the globalSetup
      // registration without also making `start:e2e` build-aware.
      //
      // Belt-and-suspenders: `build:e2e` runs inline here as a safety net so
      // that even if globalSetup fails silently the webServer still gets a
      // valid dist-e2e/index.mjs. On a warm dev loop esbuild is fast enough
      // (~1–2 s) that the safety net cost is negligible.
      //
      // The output directory is dist-e2e/ (not dist/) so this process never
      // races with the regular API Server dev workflow over the same folder.
      //
      // Health-check URL is /api/healthz (a public, no-auth endpoint that
      // always returns 200 immediately) rather than /api/datasets (which would
      // require an x-e2e-user-id header to avoid a 401 and performs a DB query
      // on every poll, masking startup failures under slow queries).
      command: `pnpm --filter @workspace/api-server run build:e2e && PORT=${E2E_API_PORT} E2E_AUTH_BYPASS=1 pnpm --filter @workspace/api-server run start:e2e`,
      url: `${E2E_API_URL}/api/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // VITE_DEV_AUTH_BYPASS=1 makes devAuth.ts stub out Clerk and inject the
      // `x-e2e-user-id` header on every /api/* fetch. This is dev-build-only
      // (gated on import.meta.env.DEV) so it cannot ship to production.
      // With this set, canvas-gated specs (drift-planner, slack-tide,
      // gps-trail, smoke, currents) render the authenticated UI and assert
      // instead of skipping on "canvas not visible".
      command: `PORT=${E2E_WEB_PORT} BASE_PATH=/ VITE_DEV_AUTH_BYPASS=1 VITE_E2E_PRESERVE_BUFFER=1 E2E_API_SERVER_URL=${E2E_API_URL} pnpm --filter @workspace/bathyscan run dev`,
      url: E2E_WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
