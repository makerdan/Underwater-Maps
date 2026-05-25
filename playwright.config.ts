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
