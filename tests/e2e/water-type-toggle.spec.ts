import { test, expect } from "@playwright/test";

/**
 * Water-type toggle end-to-end test.
 *
 * Verifies the full freshwater/saltwater switching flow wired in App.tsx
 * (waterType subscription around lines 229–285):
 *   - clicking the WaterTypeToggle updates the active button state
 *   - the DatasetPanel filters to datasets of the new water type
 *     (saltwater preset ids disappear, freshwater preset ids appear)
 *   - the depth colormap auto-switches from "ocean" → "freshwater"
 *     (the scene hue proxy — terrain mesh and depth bar are keyed by it)
 *   - switching back to saltwater restores the ocean colormap and the
 *     saltwater dataset list
 *
 * The toggle and DatasetPanel only mount once the user is signed in.
 * The e2e webServer sets VITE_DEV_AUTH_BYPASS=1 so the canvas-gated UI
 * renders during tests; if it isn't visible the suite skips rather than
 * failing the run.
 */

const SALTWATER_DATASET = "btn-dataset-thorne-bay";
const FRESHWATER_DATASET = "btn-dataset-lake-fork";

test.describe("Water-type toggle", () => {
  test("switching to freshwater and back updates UI, datasets, and colormap", async ({ page }) => {
    test.setTimeout(120_000);

    // Reset the dev user's persisted waterType to a known baseline
    // ("saltwater") before the page loads. The dev-auth bypass on the API
    // server matches on the `x-e2e-user-id` header that the frontend's
    // devAuth helper injects on every fetch; sending the same header here
    // targets the same row.
    await page.request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { waterType: "saltwater" },
    });

    await page.goto("/");

    const saltBtn = page.locator('[data-testid="water-type-saltwater"]');
    const freshBtn = page.locator('[data-testid="water-type-freshwater"]');

    // The toggle only mounts inside DatasetPanel, which itself only renders
    // when the user is signed in. With VITE_DEV_AUTH_BYPASS=1 this is the
    // expected state; if it isn't, skip gracefully.
    const toggleVisible = await saltBtn.isVisible({ timeout: 20_000 }).catch(() => false);
    if (!toggleVisible) {
      test.skip(true, "Water-type toggle not visible — user is not signed in; landing page is shown");
      return;
    }
    await expect(freshBtn).toBeVisible();

    // Wait for the saltwater dataset list to populate (also confirms the
    // store has hydrated to saltwater from the server reset above).
    await expect(page.locator(`[data-testid="${SALTWATER_DATASET}"]`)).toBeVisible({ timeout: 20_000 });

    // ---- Sanity: starts in saltwater mode ---------------------------------
    // The active button uses its theme color (#00e5ff for salt), inactive
    // collapses to #475569. Compare via computed style.
    const activeSaltColor = await saltBtn.evaluate((el) => getComputedStyle(el).color);
    const inactiveFreshColor = await freshBtn.evaluate((el) => getComputedStyle(el).color);
    expect(activeSaltColor).not.toBe(inactiveFreshColor);

    // Confirm the default colormap is "ocean" by visiting Settings.
    await page.goto("/settings");
    const colormapSelect = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelect).toBeVisible({ timeout: 15_000 });
    await expect(colormapSelect).toHaveAttribute("data-value", "ocean");
    await expect(colormapSelect).toContainText("Ocean (blue)");

    // ---- Switch to freshwater ---------------------------------------------
    await page.goto("/");
    await expect(freshBtn).toBeVisible({ timeout: 20_000 });
    await freshBtn.click();

    // Freshwater button now wears its theme color (#4ade80); saltwater dims
    // to the inactive slate color. Wait for the style transition to settle.
    await expect
      .poll(async () => saltBtn.evaluate((el) => getComputedStyle(el).color), {
        timeout: 5_000,
      })
      .not.toBe(activeSaltColor);
    const activeFreshColor = await freshBtn.evaluate((el) => getComputedStyle(el).color);
    const inactiveSaltColor = await saltBtn.evaluate((el) => getComputedStyle(el).color);
    expect(activeFreshColor).not.toBe(inactiveSaltColor);
    // The fresh button's color flipped from inactive → its active hue.
    expect(activeFreshColor).not.toBe(inactiveFreshColor);

    // DatasetPanel filters by waterType: a freshwater preset appears, the
    // saltwater preset disappears.
    await expect(page.locator(`[data-testid="${FRESHWATER_DATASET}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="${SALTWATER_DATASET}"]`)).toHaveCount(0);

    // Scene-hue proxy: the colormap auto-switched from "ocean" → "freshwater".
    // The Depth Colormap picker exposes its current value via data-value, so
    // we can verify the auto-switch directly from the Settings UI.
    await page.goto("/settings");
    const colormapSelectFresh = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelectFresh).toBeVisible({ timeout: 15_000 });
    await expect(colormapSelectFresh).toHaveAttribute("data-value", "freshwater");
    await expect(colormapSelectFresh).toContainText("Freshwater (green)");

    // ---- Switch back to saltwater -----------------------------------------
    await page.goto("/");
    await expect(saltBtn).toBeVisible({ timeout: 20_000 });
    await saltBtn.click();

    // Saltwater dataset reappears; freshwater preset is filtered out again.
    await expect(page.locator(`[data-testid="${SALTWATER_DATASET}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="${FRESHWATER_DATASET}"]`)).toHaveCount(0);

    // Colormap restored to "ocean", verified directly from the Settings UI.
    await page.goto("/settings");
    const colormapSelectOceanAgain = page.locator('[data-testid="depth-colormap-select"]');
    await expect(colormapSelectOceanAgain).toBeVisible({ timeout: 15_000 });
    await expect(colormapSelectOceanAgain).toHaveAttribute("data-value", "ocean");
    await expect(colormapSelectOceanAgain).toContainText("Ocean (blue)");
  });
});
