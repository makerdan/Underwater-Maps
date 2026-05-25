import { test, expect } from "@playwright/test";

/**
 * Settings page end-to-end tests
 *
 * Updated to match the real sidebar labels and headings in
 * artifacts/bathyscan/src/pages/Settings.tsx (see NAV_TABS).
 *
 * These tests assume the e2e auth bypass is active (set on the bathyscan
 * webServer entry in playwright.config.ts via VITE_DEV_AUTH_BYPASS=1).
 * Without it the /settings route still mounts the Settings component
 * (it isn't auth-gated), so the assertions below run regardless.
 */

test.describe("Settings page", () => {
  // NOTE: Intentionally NO beforeEach that visits "/". The home route mounts
  // the heavy Three.js scene, which under headless Chromium leaks WebGL
  // contexts across many goto("/") calls during the full Playwright run and
  // eventually crashes the renderer → ERR_CONNECTION_REFUSED on subsequent
  // page loads. Settings-only specs navigate straight to /settings, which
  // is a lightweight route with no canvas. The one keyboard-shortcut test
  // below that genuinely needs the home page navigates to "/" itself.

  test("settings page is reachable via /settings route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=SETTINGS").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=← BACK")).toBeVisible();
  });

  test("settings sidebar shows all tab labels", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Match the NAV_TABS array in Settings.tsx. Each entry below is a
    // substring that uniquely identifies its sidebar button.
    const expectedTabs = [
      "VISUALS",         // "VISUALS & PERF"
      "CAMERA & CTRL",
      "HUD & LAYOUT",
      "OVERVIEW MAP",
      "MARKERS",
      "DATA & STORAGE",
      "OFFLINE CACHE",
      "ACCOUNT & PRIVACY",
    ];
    for (const label of expectedTabs) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test("clicking a sidebar tab shows the correct section heading", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("CAMERA & CTRL")').first().click();
    await expect(page.locator("text=◈ CAMERA").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("HUD & LAYOUT")').first().click();
    await expect(page.locator("text=◈ HUD").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("MARKERS")').first().click();
    await expect(page.locator("text=◈ MARKERS").first()).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("OFFLINE CACHE")').first().click();
    await expect(page.locator("text=◈ OFFLINE").first()).toBeVisible({ timeout: 5_000 });
  });

  test("caustics toggle changes checked state in the Visuals tab", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // ToggleRow renders the label and a Radix Switch in the same row.
    // Find the row by the "Caustics Effect" label, then the switch inside it.
    const causticsRow = page.locator("div").filter({
      has: page.locator("text=Caustics Effect"),
    }).filter({
      has: page.locator('[role="switch"]'),
    }).last();
    const causticsSwitch = causticsRow.locator('[role="switch"]').first();

    await expect(causticsSwitch).toBeVisible({ timeout: 5_000 });
    const initial = await causticsSwitch.getAttribute("aria-checked");
    await causticsSwitch.click();
    const after = await causticsSwitch.getAttribute("aria-checked");
    expect(after).not.toBe(initial);
  });

  test("Visuals tab is active by default and shows colormap selector", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=◈ VISUALS").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Depth Colormap").first()).toBeVisible();
  });

  test("RESET ALL SETTINGS button is present", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("text=RESET ALL SETTINGS")).toBeVisible({ timeout: 10_000 });
  });

  test("Offline tab shows pending markers count", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("OFFLINE CACHE")').first().click();
    const count = page.locator("[data-testid='pending-markers-count']");
    await expect(count).toBeVisible({ timeout: 5_000 });
  });

  test("← BACK navigates back to the home route", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator("text=← BACK").click();
    await page.waitForURL((url) => !url.pathname.endsWith("/settings"), { timeout: 5_000 });
  });

  test("Account tab shows danger zone", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    await expect(page.locator("text=DANGER ZONE")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=DELETE ALL MY MARKERS")).toBeVisible();
  });

  test("danger zone delete button requires confirmation", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await page.locator('button:has-text("ACCOUNT & PRIVACY")').first().click();
    await page.locator("text=DELETE ALL MY MARKERS").click();

    await expect(page.locator("text=Are you sure?")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=YES, DELETE ALL")).toBeVisible();
    await expect(page.locator("text=CANCEL")).toBeVisible();
  });

  test("RESET ALL SETTINGS restores colormap to ocean after a change", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Visuals tab is active by default. Find the Depth Colormap select.
    const colormapSelect = page.locator("select").filter({ hasText: "Ocean (blue)" }).first();
    await expect(colormapSelect).toBeVisible({ timeout: 5_000 });

    // Sanity: starts on 'ocean'.
    await expect(colormapSelect).toHaveValue("ocean");

    // Change to 'viridis' and confirm the value flips.
    await colormapSelect.selectOption("viridis");
    await expect(colormapSelect).toHaveValue("viridis");

    // Trigger the global reset (two-step confirm).
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();

    // Colormap should return to its default.
    await expect(colormapSelect).toHaveValue("ocean");
  });

  test("colormap selection survives a full page reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const colormapSelect = page.locator("select").filter({ hasText: "Ocean (blue)" }).first();
    await expect(colormapSelect).toBeVisible({ timeout: 5_000 });
    await expect(colormapSelect).toHaveValue("ocean");

    // Change to a non-default value.
    await colormapSelect.selectOption("viridis");
    await expect(colormapSelect).toHaveValue("viridis");

    // Wait for the persist middleware to write to localStorage.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("bathyscan:settings");
          if (!raw) return null;
          try {
            return JSON.parse(raw)?.state?.colormapTheme ?? null;
          } catch {
            return null;
          }
        }),
        { timeout: 5_000 },
      )
      .toBe("viridis");

    // Full page reload.
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The select should still reflect the previously chosen value.
    const reloadedSelect = page.locator("select").filter({ hasText: "Viridis" }).first();
    await expect(reloadedSelect).toBeVisible({ timeout: 10_000 });
    await expect(reloadedSelect).toHaveValue("viridis");

    // Cleanup: reset to defaults via the global reset (two-step confirm).
    await page.locator("[data-testid='reset-all-btn']").click();
    await page.locator("[data-testid='confirm-reset-all-btn']").click();
    const resetSelect = page.locator("select").filter({ hasText: "Ocean (blue)" }).first();
    await expect(resetSelect).toHaveValue("ocean");
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
    await expect(page.locator("text=SETTINGS").first()).toBeVisible();
  });
});
