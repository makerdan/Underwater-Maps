import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3150",
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
      command:
        "PORT=3151 E2E_AUTH_BYPASS=1 pnpm --filter @workspace/api-server run dev",
      url: "http://localhost:3151/api/datasets",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // VITE_DEV_AUTH_BYPASS=1 makes devAuth.ts stub out Clerk and inject the
      // `x-e2e-user-id` header on every /api/* fetch. This is dev-build-only
      // (gated on import.meta.env.DEV) so it cannot ship to production.
      // With this set, canvas-gated specs (drift-planner, slack-tide,
      // gps-trail, smoke, currents) render the authenticated UI and assert
      // instead of skipping on "canvas not visible".
      command:
        "PORT=3150 BASE_PATH=/ VITE_DEV_AUTH_BYPASS=1 E2E_API_SERVER_URL=http://127.0.0.1:3151 pnpm --filter @workspace/bathyscan run dev",
      url: "http://localhost:3150",
      reuseExistingServer: !process.env["CI"],
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
