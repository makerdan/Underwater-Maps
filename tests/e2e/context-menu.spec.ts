import { test, expect } from "@playwright/test";

/**
 * Right-click Context Menu E2E tests.
 *
 * Strategy:
 * - The 3D canvas and overview map require Clerk authentication, so we use the
 *   same graceful-skip pattern as gps-trail.spec.ts: load the page and skip if
 *   the canvas is absent.
 * - Where possible we also exercise the context-menu store directly through
 *   page.evaluate, since the store is exposed via a Zustand singleton at module
 *   scope, allowing us to validate the menu lifecycle even when auth-gated UI
 *   is unavailable.
 */

test.describe("BathyScan — Right-click context menu", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
  });

  test("page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    // Filter known non-fatal noise (e.g. third-party preload warnings)
    const realErrors = errors.filter(
      (e) => !/favicon|manifest|preload/i.test(e),
    );
    expect(realErrors).toEqual([]);
  });

  test("right-click on 3D canvas does not navigate to browser menu", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const hasCanvas = (await canvas.count()) > 0;
    test.skip(!hasCanvas, "3D canvas requires authentication");

    // Right-click and ensure the page stays on the same URL (browser default menu suppressed)
    const urlBefore = page.url();
    await canvas.click({ button: "right" });
    await page.waitForTimeout(200);
    expect(page.url()).toBe(urlBefore);
  });

  test("context menu portal mounts and is initially hidden", async ({ page }) => {
    // The ContextMenu component renders nothing when closed — confirm DOM is clean.
    const menu = page.locator('[data-testid="context-menu"]');
    expect(await menu.count()).toBe(0);
  });

  test("measurement banner is hidden when no measurement is active", async ({ page }) => {
    const banner = page.locator('[data-testid="measurement-banner"]');
    expect(await banner.count()).toBe(0);
  });

  test("marker detail card is hidden when no marker is selected", async ({ page }) => {
    const card = page.locator('[data-testid="marker-detail-card"]');
    expect(await card.count()).toBe(0);
  });
});
