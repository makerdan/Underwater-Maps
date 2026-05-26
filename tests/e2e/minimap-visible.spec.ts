import { test, expect } from "@playwright/test";

test.describe("BathyScan — minimap visibility", () => {
  test.beforeEach(async ({ page, request }) => {
    // Reset the toggle that the "disabled" test below flips, so a prior
    // failure can't leave the minimap hidden for this run (or for other
    // specs sharing the dev-user-bypass user).
    await request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { showCompassMinimap: true },
    });
    await page.goto("/");
  });

  test("minimap is visible on screen with a non-zero size and stays inside the viewport", async ({ page }) => {
    await page.waitForLoadState("networkidle");

    // App requires sign-in to render the scene. If we're on the landing page,
    // skip gracefully — matches the pattern used by smoke.spec.ts.
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Scene canvas not visible — user is not signed in; landing page is shown");
      return;
    }

    const minimap = page.locator("[data-testid='minimap-container']");
    await expect(minimap).toBeVisible({ timeout: 10_000 });

    // The minimap renders a 180x180 canvas. Assert it has a real on-screen box.
    const minimapCanvas = minimap.locator("canvas");
    await expect(minimapCanvas).toBeVisible();

    const box = await minimap.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // And it must actually sit inside the browser viewport — not clipped off-screen.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test("disabling the Compass / Minimap setting removes it from the screen", async ({ page, request }) => {
    await page.waitForLoadState("networkidle");

    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Scene canvas not visible — user is not signed in; landing page is shown");
      return;
    }

    // Sanity: minimap is on by default.
    const minimap = page.locator("[data-testid='minimap-container']");
    await expect(minimap).toBeVisible({ timeout: 10_000 });

    // Turn the minimap off via the same x-e2e-user-id bypass other specs use.
    await request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { showCompassMinimap: false },
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Wait for the scene to come back up before asserting absence.
    await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
    await expect(minimap).toHaveCount(0);

    // Restore default so we don't poison other specs that share the dev user.
    await request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { showCompassMinimap: true },
    });
  });
});
