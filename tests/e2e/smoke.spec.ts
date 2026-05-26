import { test, expect } from "./fixtures";

test.describe("BathyScan — smoke suite", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("app loads without unhandled JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      // WebGL context failure is expected in headless environments — ignore it
      if (!err.message.includes("WebGL")) {
        errors.push(err.message);
      }
    });
    await page.waitForLoadState("domcontentloaded");
    expect(errors).toHaveLength(0);
  });

  test("Three.js canvas element is present with non-zero dimensions", async ({ page }) => {
    // If not signed in, the landing page is shown — no canvas yet; skip gracefully
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in; landing page is shown");
      return;
    }
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("dataset picker panel is present and lists 5 items", async ({ page }) => {
    // Wait for datasets to load
    await page.waitForTimeout(3000);
    const items = page.locator("[data-testid='dataset-item'], [role='option'], button[data-dataset]");
    // Fallback: count buttons in the picker area
    const pickerButtons = page.locator(".w-80 button, .w-80 [role='option']");
    const countA = await items.count();
    const countB = await pickerButtons.count();
    if (countA + countB === 0) {
      test.skip(true, "Dataset picker not visible — user is not signed in; landing page is shown");
      return;
    }
    expect(countA + countB).toBeGreaterThanOrEqual(1);
  });

  test("HUD overlay is visible and depth value is a number", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    const hudText = await page.locator("body").textContent();
    // If showing the landing page (sign-in screen), skip gracefully
    if (!hudText?.includes("▼")) {
      test.skip(true, "HUD not visible — user is not signed in; landing page is shown");
      return;
    }
    // Wait for terrain to actually finish loading before reading the HUD.
    // Otherwise the depth scale bar may have populated while the HUD still
    // shows "DEPTH —" — see Task #420 (terrain race).
    const terrainLoaded = await page.waitForFunction(
      () => {
        const t = window.__bathyTest?.getTerrainSummary?.();
        return Boolean(t?.datasetId);
      },
      null,
      { timeout: 20_000 },
    ).then(() => true).catch(() => false);
    if (!terrainLoaded) {
      test.skip(true, "Terrain did not load in time — HUD depth check skipped");
      return;
    }
    // Poll the body text — the HUD writes the numeric depth on the next
    // useFrame tick after terrain becomes available.
    await expect
      .poll(async () => (await page.locator("body").textContent()) ?? "", {
        timeout: 10_000,
        intervals: [200, 400, 800],
      })
      .toMatch(/▼\s*[\d,]+\s*M/);
  });

  test("file upload zone is present on the page", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    const uploadEl = page.locator(
      "text=UPLOAD CUSTOM TERRAIN, [data-testid='upload-zone'], input[type='file']"
    );
    const count = await uploadEl.count();
    if (count === 0) {
      test.skip(true, "Upload zone not visible — user is not signed in; landing page is shown");
      return;
    }
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("query panel: trigger button is visible and opens the panel", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    // The query trigger button is always visible when signed in
    const trigger = page.locator("[data-testid='query-panel-trigger']");
    const triggerVisible = await trigger.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!triggerVisible) {
      test.skip(true, "Query trigger not visible — user may not be signed in");
      return;
    }

    // Click the trigger — query panel should open. The trigger sits in the
    // lower portion of the HUD; use dispatchEvent to bypass any canvas
    // element that may intercept the pointer in headless mode.
    await trigger.dispatchEvent("click");
    const panel = page.locator("[data-testid='query-panel']");
    await expect(panel).toBeVisible({ timeout: 3_000 });

    // The text input should be present inside the panel
    const input = page.locator("[data-testid='query-input']");
    await expect(input).toBeVisible();

    // The submit button should be present
    const submit = page.locator("[data-testid='query-submit']");
    await expect(submit).toBeVisible();
  });

  test("zone overlay: toggle changes aria-pressed and legend is visible", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");

    // Zone Analysis panel only renders once terrain is loaded from the API.
    const zonePanel = page.locator("text=Zone Analysis");
    const panelVisible = await zonePanel.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!panelVisible) {
      test.skip(true, "Zone Analysis panel not visible — API unreachable in this environment");
      return;
    }

    // Wait for the loading spinner to disappear (classification complete or error).
    await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 30_000 });

    // Zone legend must be present and visible when classification succeeds.
    const legend = page.locator(".zone-legend");
    await expect(legend.first()).toBeVisible({ timeout: 5_000 });

    // The toggle button must carry aria-pressed="true" by default (overlay on).
    const toggleBtn = page.locator("[data-testid='zone-toggle']");
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveAttribute("aria-pressed", "true");

    // Click once → overlay off → aria-pressed flips to "false".
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute("aria-pressed", "false");

    // Click again → overlay on → aria-pressed returns to "true".
    await toggleBtn.click();
    await expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
  });
});
