import { test, expect, type Page } from "@playwright/test";

/**
 * Depth profile e2e: drives the right-click flow via the dev-only test API
 * (window.__bathyTest). Two terrain menu opens mirror the in-app flow —
 * first click sets the anchor, second click builds the profile (against a
 * synthetic terrain grid since the real one needs auth + a loaded dataset).
 *
 * Asserts the panel renders with a non-empty SVG path, sensible LEN/MIN/MAX
 * stats, and that the × button dismisses it.
 */

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 10_000,
  });
}

test.describe("BathyScan — Depth profile flow", () => {
  test.beforeEach(async ({ page }) => {
    // Stub /api/folders → [] so DatasetFolderTree doesn't crash on
    // malformed folder data (pre-existing bug unrelated to this test).
    // Stub library-loading endpoints with empty arrays so DatasetPanel /
    // DatasetFolderTree don't crash on pre-existing malformed responses
    // (unrelated to the depth-profile feature under test).
    const emptyJson = (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    await page.route("**/api/user/folders**", emptyJson);
    await page.route("**/api/datasets**", emptyJson);
    await page.route("**/api/user/datasets**", emptyJson);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.evaluate(() => window.__bathyTest!.clearDepthProfile());
  });

  test("first right-click sets anchor, second builds profile, × dismisses it", async ({
    page,
  }) => {
    // ── 1st right-click: open terrain menu, choose "Start depth profile here" ──
    await page.evaluate(() => {
      window.__bathyTest!.showDepthProfileTerrainMenu(150, 150, {
        lon: -132.5,
        lat: 56.0,
        depth: 0,
      });
    });

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible();
    const startItem = menu
      .locator('[role="menuitem"]')
      .filter({ hasText: "Start depth profile here" });
    await expect(startItem).toBeVisible();
    await startItem.click();
    await expect(menu).toHaveCount(0);

    // Panel should not yet be rendered (only anchor set)
    expect(
      await page.locator('[data-testid="depth-profile-panel"]').count(),
    ).toBe(0);

    // ── 2nd right-click: now reads "End depth profile here" ──
    await page.evaluate(() => {
      window.__bathyTest!.showDepthProfileTerrainMenu(400, 300, {
        lon: -132.3,
        lat: 56.05,
        depth: 1000,
      });
    });
    await expect(menu).toBeVisible();
    const endItem = menu
      .locator('[role="menuitem"]')
      .filter({ hasText: "End depth profile here" });
    await expect(endItem).toBeVisible();
    await endItem.click();
    await expect(menu).toHaveCount(0);

    // ── Panel renders with chart + stats ──
    const panel = page.locator('[data-testid="depth-profile-panel"]');
    await expect(panel).toBeVisible();

    // Stats row
    await expect(panel).toContainText("LEN");
    await expect(panel).toContainText("MIN");
    await expect(panel).toContainText("MAX");

    // SVG polyline path is non-empty (`d` attribute contains M…L… commands)
    const pathD = await panel
      .locator("svg path")
      .nth(1) // 0 = area fill, 1 = polyline
      .getAttribute("d");
    expect(pathD).toBeTruthy();
    expect(pathD!.length).toBeGreaterThan(20);
    expect(pathD).toMatch(/M[\d.,\s-]+L/);

    // Underlying store agrees: 96 samples, MIN < MAX, positive distance
    const summary = await page.evaluate(() =>
      window.__bathyTest!.getDepthProfileSummary(),
    );
    expect(summary).not.toBeNull();
    expect(summary!.points).toBe(96);
    expect(summary!.totalDistanceM).toBeGreaterThan(0);
    expect(summary!.minDepthM).toBeLessThan(summary!.maxDepthM);

    // ── × button dismisses the panel ──
    await panel
      .getByRole("button", { name: /close depth profile/i })
      .click();
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.__bathyTest!.getDepthProfileSummary(),
      ),
    ).toBeNull();
  });
});
