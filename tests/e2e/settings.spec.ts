import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("settings page is reachable via /settings route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Header should say SETTINGS
    await expect(page.locator("text=SETTINGS")).toBeVisible({ timeout: 5_000 });
    // Back button should be present
    await expect(page.locator("text=← BACK")).toBeVisible();
  });

  test("settings sidebar shows all tab labels", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const expectedTabs = ["VISUALS", "NAVIGATION", "HUD", "OVERVIEW MAP", "MARKERS", "DATASET", "OFFLINE", "ACCOUNT"];
    for (const label of expectedTabs) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("clicking a sidebar tab shows the correct section heading", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Click Navigation tab
    await page.locator('button:has-text("NAVIGATION")').first().click();
    await expect(page.locator("text=◈ NAVIGATION")).toBeVisible({ timeout: 3_000 });

    // Click HUD tab
    await page.locator('button:has-text("HUD")').first().click();
    await expect(page.locator("text=◈ HUD")).toBeVisible({ timeout: 3_000 });

    // Click Markers tab
    await page.locator('button:has-text("MARKERS")').first().click();
    await expect(page.locator("text=◈ MARKERS")).toBeVisible({ timeout: 3_000 });

    // Click Offline tab
    await page.locator('button:has-text("OFFLINE")').first().click();
    await expect(page.locator("text=◈ OFFLINE")).toBeVisible({ timeout: 3_000 });
  });

  test("caustics toggle changes checked state in the Visuals tab", async ({ page }) => {
    await page.goto("/settings");
    // Visuals tab is active by default; find the caustics toggle
    const toggle = page.locator('[role="switch"][aria-label*="austics"], button:has-text("ENABLE CAUSTICS")').first();
    // If there's no aria-label, find it by proximity to the label
    const causticsSwitch = page.locator('button[role="switch"]').filter({ hasText: "" }).nth(1);
    const initialChecked = await causticsSwitch.getAttribute("aria-checked");
    await causticsSwitch.click();
    const newChecked = await causticsSwitch.getAttribute("aria-checked");
    expect(newChecked).not.toBe(initialChecked);
  });

  test("Visuals tab is active by default and shows colormap selector", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Default section heading
    await expect(page.locator("text=◈ VISUALS")).toBeVisible({ timeout: 5_000 });

    // Colormap selector is present
    await expect(page.locator("text=Depth Colormap")).toBeVisible();
  });

  test("RESET DEFAULTS button is visible in the top bar", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=RESET DEFAULTS")).toBeVisible({ timeout: 5_000 });
  });

  test("Offline tab shows pending markers count", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("OFFLINE")').first().click();
    const count = page.locator("[data-testid='pending-markers-count']");
    await expect(count).toBeVisible({ timeout: 5_000 });
  });

  test("← BACK navigates back to the home route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator("text=← BACK").click();
    // Should navigate away from /settings
    await page.waitForURL((url) => !url.pathname.endsWith("/settings"), { timeout: 5_000 });
  });

  test("Account tab shows danger zone", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT")').first().click();
    await expect(page.locator("text=DANGER ZONE")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=DELETE ALL MY MARKERS")).toBeVisible();
  });

  test("danger zone delete button requires confirmation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT")').first().click();
    await page.locator("text=DELETE ALL MY MARKERS").click();

    // Confirmation step should appear
    await expect(page.locator("text=Are you sure?")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("text=YES, DELETE ALL")).toBeVisible();
    await expect(page.locator("text=CANCEL")).toBeVisible();
  });

  test("comma keyboard shortcut navigates to /settings from the main page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Only works when signed in (app main page visible)
    const isSignedIn = await page.locator("canvas, [data-testid='hud']").isVisible({ timeout: 5_000 }).catch(() => false);
    if (!isSignedIn) {
      test.skip(true, "Keyboard shortcut only works when signed in and canvas is visible");
      return;
    }

    await page.keyboard.press(",");
    await page.waitForURL((url) => url.pathname.includes("settings"), { timeout: 5_000 });
    await expect(page.locator("text=SETTINGS")).toBeVisible();
  });
});
