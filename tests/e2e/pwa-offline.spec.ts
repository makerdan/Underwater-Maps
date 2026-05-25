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
  test("manifest.json is served with correct fields", async ({ page }) => {
    const res = await page.goto(`${BASE}/manifest.json`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const json = (await res?.json()) as Record<string, unknown>;
    expect(json.name).toBe("BathyScan");
    expect(json.display).toBe("standalone");
    expect(json.theme_color).toBe("#020818");
    expect(Array.isArray(json.icons)).toBe(true);
    const icons = json.icons as Array<Record<string, unknown>>;
    const sizes = icons.map((i) => i.sizes as string);
    expect(sizes.some((s) => s.includes("192"))).toBe(true);
    expect(sizes.some((s) => s.includes("512"))).toBe(true);
  });

  test("index.html has manifest link, theme-color, and apple-mobile-web-app meta", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute("href")).catch(() => null);
    expect(manifestHref).not.toBeNull();

    const themeColor = await page.$eval('meta[name="theme-color"]', (el) => el.getAttribute("content")).catch(() => null);
    expect(themeColor).toBe("#020818");

    const appleCapable = await page.$('meta[name="apple-mobile-web-app-capable"]');
    expect(appleCapable).not.toBeNull();

    const appleTitle = await page.$('meta[name="apple-mobile-web-app-title"]');
    expect(appleTitle).not.toBeNull();
  });

  test("icon-192.png is served as image/png", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-192.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/image\/png/);
  });

  test("icon-512.png is served as image/png", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-512.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/image\/png/);
  });
});

test.describe("Offline indicator & query panel", () => {
  test("offline badge appears when offline event is dispatched", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvas = await page.$("canvas");
    if (!canvas) {
      test.skip();
      return;
    }

    // Simulate going offline via browser events
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });

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

    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });

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

test.describe("Offline network-abort scenario", () => {
  test("offline badge appears when all API routes are blocked", async ({ page }) => {
    // Let the page load first (without blocking)
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvas = await page.$("canvas");
    if (!canvas) {
      test.skip();
      return;
    }

    // Block all API requests to simulate offline
    await page.route("**/api/**", (route) => route.abort("failed"));

    // Dispatch offline event to drive the store
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
      window.dispatchEvent(new Event("offline"));
    });

    const badge = page.locator('[data-testid="offline-badge"]');
    await expect(badge).toBeVisible({ timeout: 4000 });
    await expect(badge).toContainText("OFFLINE");
  });

  test("Settings page is accessible and shows cache management UI", async ({ page }) => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    // Settings page should render without crashing
    const clearBtn = page.locator('[data-testid="clear-all-cache-btn"]');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await expect(clearBtn).toContainText("CLEAR ALL");
    // Pending markers count is shown
    const pendingCount = page.locator('[data-testid="pending-markers-count"]');
    await expect(pendingCount).toBeVisible();
  });
});
