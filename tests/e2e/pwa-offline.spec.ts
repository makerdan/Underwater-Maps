import { test, expect } from "@playwright/test";
import { terrainCanvas } from "./_helpers/canvases";

/**
 * PWA / Offline Mode E2E tests.
 *
 * Strategy:
 * 1. Manifest/meta/icon tests — request the static assets directly.
 * 2. Offline-UI tests — load the app, then dispatch the offline event and
 *    optionally block API routes with page.route, then assert the UI adapts.
 * 3. Warm-load + network-abort test — let the app load fully (terrain warm-
 *    up), then intercept ALL requests to simulate the device going offline;
 *    verify the canvas is still present, the offline badge appears, the query
 *    panel is disabled, and the dataset picker shows unavailable indicators.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3150";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function goOffline(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
    window.dispatchEvent(new Event("offline"));
  });
}

async function goOnline(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });
}

// ── Manifest & meta tags ─────────────────────────────────────────────────────

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
    const manifestHref = await page
      .$eval('link[rel="manifest"]', (el) => el.getAttribute("href"))
      .catch(() => null);
    expect(manifestHref).not.toBeNull();

    const themeColor = await page
      .$eval('meta[name="theme-color"]', (el) => el.getAttribute("content"))
      .catch(() => null);
    expect(themeColor).toBe("#020818");

    const appleCapable = await page.$('meta[name="apple-mobile-web-app-capable"]');
    expect(appleCapable).not.toBeNull();

    const appleTitle = await page.$('meta[name="apple-mobile-web-app-title"]');
    expect(appleTitle).not.toBeNull();
  });

  test("icon-192.png is served as image/png", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-192.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    expect(res?.headers()["content-type"]).toMatch(/image\/png/);
  });

  test("icon-512.png is served as image/png", async ({ page }) => {
    const res = await page.goto(`${BASE}/icon-512.png`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    expect(res?.headers()["content-type"]).toMatch(/image\/png/);
  });
});

// ── Offline indicator & query panel ─────────────────────────────────────────

test.describe("Offline indicator & query panel", () => {
  test("offline badge appears when offline event is dispatched", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    // Wait briefly for the canvas to mount — `page.$` is a one-shot probe
    // and races the React app's first render under sequential suite load.
    const canvasVisible = await page
      .locator("canvas")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!canvasVisible) {
      test.skip();
      return;
    }

    await goOffline(page);

    const badge = page.locator('[data-testid="offline-badge"]');
    await expect(badge).toBeVisible({ timeout: 3000 });
    await expect(badge).toContainText("OFFLINE");

    await goOnline(page);
    await expect(badge).not.toBeVisible({ timeout: 3000 });
  });

  test("query panel shows offline notice and disables input when offline", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvasVisible = await page
      .locator("canvas")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!canvasVisible) {
      test.skip();
      return;
    }

    await goOffline(page);

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

// ── Warm-load + full network-abort offline scenario ──────────────────────────

test.describe("Offline network-abort scenario", () => {
  /**
   * After the app has had a chance to load, we block all network requests and
   * simulate the offline event.  We verify:
   *   - The 3-D canvas element is still present (terrain rendered before abort)
   *   - The offline badge is shown
   *   - Any dataset listed in the picker shows an availability indicator
   *   - The query panel input is disabled
   */
  test("canvas persists and offline badge appears after full network block", async ({ page }) => {
    // 1. Load the app and wait for the canvas + terrain to appear
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvas = await page.$("canvas");
    if (!canvas) {
      // Not signed in — terrain never loads; skip gracefully
      test.skip();
      return;
    }

    // Give the terrain a moment to start loading
    await page.waitForTimeout(1500);

    // 2. Block all API routes to simulate device going offline
    await page.route("**/api/**", (route) => route.abort("failed"));

    // 3. Dispatch the offline event so the store updates
    await goOffline(page);

    // 4. The terrain canvas (three.js renderer) must still be in the DOM.
    // The HUD now also mounts a Minimap <canvas>, so a plain `canvas`
    // selector trips strict-mode — use the shared helper.
    const canvasAfter = terrainCanvas(page);
    await expect(canvasAfter).toBeAttached({ timeout: 3000 });

    // 5. Offline badge must be visible
    const badge = page.locator('[data-testid="offline-badge"]');
    await expect(badge).toBeVisible({ timeout: 4000 });
    await expect(badge).toContainText("OFFLINE");
  });

  test("query panel is disabled and shows offline notice after network block", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    if (!(await page.$("canvas"))) {
      test.skip();
      return;
    }

    await page.waitForTimeout(1000);
    await page.route("**/api/**", (route) => route.abort("failed"));
    await goOffline(page);

    // Open the query panel
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
  });

  test("dataset picker shows availability indicators when offline", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const canvasVisible = await page
      .locator("canvas")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!canvasVisible) {
      test.skip();
      return;
    }

    // Give the dataset list a moment to render before blocking the network.
    await page.waitForTimeout(1500);
    await page.route("**/api/**", (route) => route.abort("failed"));
    await goOffline(page);

    // The dataset panel should show either cached (✓) or unavailable (✗) badges.
    // In the test environment the SW cache is cold, so we expect ✗ badges.
    const unavailableBadges = page.locator('[data-testid^="unavailable-badge-"]');
    const cachedBadges = page.locator('[data-testid^="cache-badge-"]');

    // Poll: the badges render once the offline event propagates through the
    // dataset panel, which can take a frame or two under suite load.
    await expect
      .poll(
        async () =>
          (await unavailableBadges.count()) + (await cachedBadges.count()),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
  });

  test("Settings page is accessible and shows cache management UI", async ({ page }) => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });

    // Navigate to the Offline tab (cache management lives there in the tabbed layout)
    const offlineTab = page.locator('button:has-text("OFFLINE")').first();
    await expect(offlineTab).toBeVisible({ timeout: 5000 });
    await offlineTab.click();

    const clearBtn = page.locator('[data-testid="clear-all-cache-btn"]');
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await expect(clearBtn).toContainText("CLEAR ALL");

    const pendingCount = page.locator('[data-testid="pending-markers-count"]');
    await expect(pendingCount).toBeVisible();
  });
});
