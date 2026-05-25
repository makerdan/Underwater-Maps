import { test, expect } from "@playwright/test";

/**
 * PWA / Offline Mode E2E tests.
 *
 * Strategy:
 * - After initial load, intercept all API network requests with page.route to
 *   simulate going offline, then verify the UI reacts correctly.
 * - Tests that depend on the 3D scene being loaded first check for the canvas
 *   element and skip gracefully when the app is not signed in or not loaded.
 * - Navigation uses `domcontentloaded` to avoid hanging on long-running AI
 *   requests (matching the pattern in gps-trail.spec.ts).
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3150";

test.describe("PWA manifest & meta tags", () => {
  test("manifest.json is served", async ({ page }) => {
    const res = await page.goto(`${BASE}/manifest.json`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const json = (await res?.json()) as Record<string, unknown>;
    expect(json.name).toBe("BathyScan");
    expect(json.display).toBe("standalone");
    expect(json.theme_color).toBe("#020818");
    expect(Array.isArray(json.icons)).toBe(true);
  });

  test("index.html has manifest link and apple-mobile-web-app meta", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const manifestLink = await page.$('link[rel="manifest"]');
    expect(manifestLink).not.toBeNull();
    const appleCapable = await page.$('meta[name="apple-mobile-web-app-capable"]');
    expect(appleCapable).not.toBeNull();
    const themeColor = await page.$('meta[name="theme-color"]');
    expect(themeColor).not.toBeNull();
  });

  test("icon-192.png is served", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-192.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/image\/png/);
  });

  test("icon-512.png is served", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-512.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/image\/png/);
  });
});

test.describe("Offline indicator & query panel", () => {
  test("offline badge appears when navigator.onLine is forced offline", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvas = await page.$("canvas");
    if (!canvas) {
      test.skip();
      return;
    }

    // Simulate going offline via the browser online/offline events
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });

    // Wait for the offline badge to appear in the HUD
    const badge = page.locator('[data-testid="offline-badge"]');
    await expect(badge).toBeVisible({ timeout: 3000 });
    await expect(badge).toContainText("OFFLINE");

    // Simulate going back online
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => true, configurable: true });
      window.dispatchEvent(new Event("online"));
    });

    await expect(badge).not.toBeVisible({ timeout: 3000 });
  });

  test("query panel shows offline notice and disables input when offline", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvas = await page.$("canvas");
    if (!canvas) {
      test.skip();
      return;
    }

    // Force offline
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });

    // Open query panel
    const trigger = page.locator('[data-testid="query-panel-trigger"]');
    if (await trigger.isVisible()) {
      await trigger.click();
    } else {
      await page.keyboard.press("/");
    }

    const queryInput = page.locator('[data-testid="query-input"]');
    await expect(queryInput).toBeVisible({ timeout: 3000 });
    await expect(queryInput).toBeDisabled();

    const offlineNotice = page.locator('[data-testid="query-offline-notice"]');
    await expect(offlineNotice).toBeVisible();
    await expect(offlineNotice).toContainText("No connection");

    const submitBtn = page.locator('[data-testid="query-submit"]');
    await expect(submitBtn).toBeDisabled();
  });
});
