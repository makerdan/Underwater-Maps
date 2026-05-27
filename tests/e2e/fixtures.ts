import { test as base, expect } from "@playwright/test";
import type { Page, Locator, APIRequestContext, APIResponse } from "@playwright/test";

/**
 * Shared Playwright fixtures for the BathyScan e2e suite.
 *
 * The suite shares a single dev-bypass user (dev-user-bypass) across all
 * specs. If a test crashes before its own cleanup step, the next spec
 * inherits whatever state was left behind — wrong units, hidden minimap,
 * wrong waterType, etc. — and fails for an unrelated reason.
 *
 * The `resetSettings` fixture runs automatically before every test (auto:
 * true). It issues a single PUT /api/settings with the complete set of
 * default values that specs care about, so each spec starts from a clean
 * baseline without duplicating the reset logic.
 */

const API_URL = "http://127.0.0.1:3151";
const E2E_USER_ID = "dev-user-bypass";

export const DEFAULT_SETTINGS = {
  units: "metric",
  waterType: "saltwater",
  colormapTheme: "ocean",
  showCompassMinimap: true,
} as const;

export const test = base.extend<{ resetSettings: void }>({
  resetSettings: [
    async ({ request }, use) => {
      await request.put(`${API_URL}/api/settings`, {
        headers: { "x-e2e-user-id": E2E_USER_ID },
        data: DEFAULT_SETTINGS,
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page, Locator, APIRequestContext, APIResponse };
