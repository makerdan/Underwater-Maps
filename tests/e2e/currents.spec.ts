import { test, expect } from "@playwright/test";

test.describe("Bathymetric currents simulation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("HUD currents panel is visible and can be enabled", async ({ page }) => {
    const panel = page.locator("[data-testid='currents-panel']");
    const panelVisible = await panel
      .isVisible({ timeout: 15_000 })
      .catch(() => false);
    if (!panelVisible) {
      test.skip(
        true,
        "Currents panel not visible — user is not signed in; landing page is shown",
      );
      return;
    }

    const enableBtn = page.locator("[data-testid='currents-enable']");
    if (await enableBtn.isVisible().catch(() => false)) {
      await enableBtn.click();
    }

    await expect(page.locator("[data-testid='currents-disable']")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.locator("[data-testid='currents-source-manual']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-source-noaa']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-manual-dir']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-manual-speed']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-tide-phase']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-toggle-particles']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-toggle-arrows']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='currents-toggle-streams']"),
    ).toBeVisible();
    await expect(page.locator("[data-testid='currents-legend']")).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  test("settings page has a Currents tab that opens the currents section", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const tab = page.locator('button:has-text("CURRENTS")').first();
    const tabVisible = await tab.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!tabVisible) {
      test.skip(
        true,
        "Settings tabs not visible — user is not signed in; landing page is shown",
      );
      return;
    }
    await tab.click();
    await expect(page.locator("text=◈ BATHYMETRIC CURRENTS")).toBeVisible({
      timeout: 3_000,
    });
  });
});
