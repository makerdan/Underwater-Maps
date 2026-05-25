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
  webServer: {
    command: "PORT=3150 BASE_PATH=/ pnpm --filter @workspace/bathyscan run dev",
    url: "http://localhost:3150",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
