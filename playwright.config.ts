import { spawnSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import budgets from "./tests/timeout-guard/budgets.json";
import {
  E2E_WEB_PORT,
  E2E_API_PORT,
  E2E_WEB_URL,
  E2E_API_URL,
  E2E_DIST_DIR,
} from "./tests/e2e/ports";
// Per-suite bypass identity — single source of truth in fixtures.ts (derived
// from E2E_RUN_SUFFIX / E2E_USER_ID) so the specs and the browser-side header
// injection can never disagree.
import { E2E_USER_ID } from "./tests/e2e/fixtures";

// ── Stale-port sweep at config-load time ────────────────────────────────────
// Playwright's webServer manager probes each webServer URL BEFORE spawning the
// command; when `reuseExistingServer: false` and a stale holder (e.g. an
// orphaned server from a SIGKILLed previous run) is bound to the port, the run
// aborts with "port is already used" without ever executing the sweep that is
// prepended to the webServer command below. The only hook that runs earlier
// than that probe is this config module's evaluation in the runner process, so
// the sweep lives here. The PW_E2E_PORT_SWEEP_DONE guard makes it run exactly
// once per invocation: worker processes and report subprocesses inherit the
// runner's env and skip it, so a mid-run config reload can never kill the
// live servers (kill-port-holders additionally never touches this process's
// own ancestor tree).
if (!process.env["PW_E2E_PORT_SWEEP_DONE"]) {
  process.env["PW_E2E_PORT_SWEEP_DONE"] = "1";
  spawnSync(
    process.execPath,
    ["scripts/kill-port-holders.mjs", String(E2E_API_PORT), String(E2E_WEB_PORT)],
    { stdio: "inherit", cwd: __dirname, timeout: 15_000 },
  );
}

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
    // ── Setup project ─────────────────────────────────────────────────────
    // Runs immediately after webServer starts (before any spec file). Polls
    // /api/healthz to confirm the API server is still alive and stable.
    // Playwright skips all projects that declare `dependencies: ["setup"]`
    // when this project fails, replacing 400+ cascade failures with a single
    // clear diagnostic that names the API server as the root cause.
    {
      name: "setup",
      testMatch: /api-liveness\.setup\.ts$/,
    },
    // ── Main browser project ───────────────────────────────────────────────
    {
      name: "chromium",
      dependencies: ["setup"],
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
      // The output directory is E2E_DIST_DIR (dist-e2e/ for the default-port
      // run, dist-e2e-<port>/ for relocated runs like the palette suite) so
      // this process never races with the regular API Server dev workflow —
      // or with a parallel e2e run on other ports — over the same folder.
      //
      // Health-check URL is /api/healthz (a public, no-auth endpoint that
      // always returns 200 immediately) rather than /api/datasets (which would
      // require an x-e2e-user-id header to avoid a 401 and performs a DB query
      // on every poll, masking startup failures under slow queries).
      // Port sweep runs INSIDE this command (not only in globalSetup) because
      // Playwright spawns webServer processes BEFORE globalSetup executes —
      // a stale holder of the API port (e.g. an orphaned server from a
      // SIGKILLed previous run or a misdirected dev workflow) would otherwise
      // EADDRINUSE this boot before the globalSetup sweep ever runs.
      // kill-port-holders.mjs skips holders in this run's own process tree,
      // so it can never kill the sibling Vite webServer or Playwright itself.
      //
      // DB_CONNECTION_TIMEOUT_MS is raised from the 5 s default: during e2e
      // boots many workflows hit the managed Postgres at once and cold
      // connection setup can exceed 5 s, producing "Connection terminated due
      // to connection timeout" on the startup queries. A 30 s acquire window
      // rides out that transient contention instead of failing.
      command: `node scripts/kill-port-holders.mjs ${E2E_API_PORT} && DIST_DIR=${E2E_DIST_DIR} pnpm --filter @workspace/api-server run build:e2e && PORT=${E2E_API_PORT} DIST_DIR=${E2E_DIST_DIR} E2E_AUTH_BYPASS=1 DB_CONNECTION_TIMEOUT_MS=30000 pnpm --filter @workspace/api-server run start:e2e`,
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
      // VITE_E2E_USER_ID keeps the browser-side bypass identity in lockstep
      // with tests/e2e/fixtures.ts E2E_USER_ID (both derive from the same
      // run suffix / E2E_USER_ID env var), so a secondary suite on its own
      // ports uses its own settings rows and cannot clobber a concurrently
      // running suite's state.
      command: `PORT=${E2E_WEB_PORT} BASE_PATH=/ VITE_DEV_AUTH_BYPASS=1 VITE_E2E_PRESERVE_BUFFER=1 VITE_E2E_USER_ID=${E2E_USER_ID} E2E_API_SERVER_URL=${E2E_API_URL} pnpm --filter @workspace/bathyscan run dev`,
      url: E2E_WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
