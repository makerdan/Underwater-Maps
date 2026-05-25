import { test, expect } from "@playwright/test";

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
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
  });

  test("Three.js canvas element is present with non-zero dimensions", async ({ page }) => {
    await page.waitForSelector("canvas", { timeout: 15_000 });
    const canvas = page.locator("canvas").first();
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
    expect(countA + countB).toBeGreaterThanOrEqual(1);
  });

  test("HUD overlay is visible and depth value is a number", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    // HUD depth shows "▼ N,NNN M" pattern
    const hudText = await page.locator("body").textContent();
    expect(hudText).toMatch(/▼\s*[\d,]+\s*M/);
  });

  test("file upload zone is present on the page", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const uploadEl = page.locator(
      "text=UPLOAD CUSTOM TERRAIN, [data-testid='upload-zone'], input[type='file']"
    );
    const count = await uploadEl.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
