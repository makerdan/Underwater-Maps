/**
 * Task #66 — UI half of the smooth-terrain toggle.
 *
 * Verifies that clicking the "Smooth terrain spikes" switch on the Settings
 * page persists its new state across a full page reload. This guards against
 * the most likely silent regression for this feature: a refactor that breaks
 * the localStorage/server sync of `smoothTerrainSpikes`, leaving stale UI
 * state on reload while the terrain pipeline keeps using whatever the user
 * last saw.
 *
 * Companion coverage lives in `artifacts/api-server/src/__tests__/`:
 *   - gridder.test.ts            → gridPoints smoothing flag (depth range)
 *   - smooth-terrain.test.ts     → PUT /settings → GET /terrain integration
 */
import { test, expect } from "./fixtures";

test.describe("Smooth terrain spikes toggle", () => {
  test("toggle state persists across reload", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // VISUALS tab is active by default. The toggle lives inside the
    // Advanced disclosure → expand it first.
    const advanced = page.locator('[data-testid="visuals-advanced"]');
    await expect(advanced).toBeVisible({ timeout: 5_000 });
    const expander = advanced.locator('button[aria-expanded]').first();
    if ((await expander.getAttribute("aria-expanded")) === "false") {
      await expander.click();
    }

    // Locate the switch by walking up from its label.
    const row = advanced.locator("text=Smooth terrain spikes").locator("xpath=..").locator("xpath=..");
    const toggle = row.locator('[role="switch"]').first();
    await expect(toggle).toBeVisible({ timeout: 5_000 });

    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    const flipped = await toggle.getAttribute("aria-checked");
    expect(flipped).not.toBe(initial);

    // Give the settings store time to persist (localStorage write + any
    // server sync flush).
    await page.waitForTimeout(500);

    // Hard reload — must wipe any in-memory React state so we're reading
    // from the persisted source on remount.
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Re-expand advanced section after reload.
    const advanced2 = page.locator('[data-testid="visuals-advanced"]');
    const expander2 = advanced2.locator('button[aria-expanded]').first();
    if ((await expander2.getAttribute("aria-expanded")) === "false") {
      await expander2.click();
    }

    const row2 = advanced2.locator("text=Smooth terrain spikes").locator("xpath=..").locator("xpath=..");
    const toggle2 = row2.locator('[role="switch"]').first();
    await expect(toggle2).toBeVisible({ timeout: 5_000 });

    expect(await toggle2.getAttribute("aria-checked")).toBe(flipped);

    // Cleanup: flip it back so the next test run starts from the same state.
    await toggle2.click();
    await page.waitForTimeout(200);
  });
});
