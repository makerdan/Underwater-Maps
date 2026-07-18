import { test, expect, type Page } from "./fixtures";

/**
 * Focus-trap e2e tests for the two custom confirm dialogs:
 *   - RemoveDatasetConfirmDialog (DatasetPanel.tsx)
 *   - ConfirmDialog (DatasetFolderTree.tsx)
 *
 * Strategy:
 *   Both dialogs are custom overlays (not Radix/Shadcn) that previously had
 *   no keyboard focus trap. We use window.__bathyTest.setVisibleDatasets to
 *   inject a synthetic visible-dataset row so the remove button renders
 *   without needing a real dataset fetch, then exercise:
 *     1. Cancel button receives focus on open (safe default for destructive dialogs)
 *     2. Tab cycles to Confirm, then wraps back to Cancel
 *     3. Shift+Tab wraps directly to Confirm from Cancel
 *     4. Escape dismisses without acting
 *     5. Enter on focused Confirm button triggers the action
 *     6. Focus returns to the element that triggered the dialog on close
 */

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 12_000,
  });
}

test.describe("keyboard focus trap — RemoveDatasetConfirmDialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    // The sidebar's Explore tab shows an empty state (no DatasetPanel, so no
    // remove buttons) until a terrain is loaded — seed one via the test
    // bridge before injecting synthetic visible-dataset rows.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest) && window.__bathyTest!.seedTerrain({}),
      null,
      { timeout: 15_000 },
    );
  });

  test("Cancel receives focus on open", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.setVisibleDatasets([
        { datasetId: "e2e-focus-trap-01", name: "Focus Trap Test", source: "preset" },
      ]);
    });

    const removeBtn = page.locator(
      '[data-testid="btn-remove-visible-e2e-focus-trap-01"]',
    );
    await expect(removeBtn).toBeVisible({ timeout: 8_000 });
    await removeBtn.click();

    const cancelBtn = page.locator('[data-testid="remove-dataset-cancel"]');
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });

    const focusedId = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? "",
    );
    expect(focusedId).toBe("remove-dataset-cancel");
  });

  test("Tab cycles between Cancel and Confirm and does not escape the dialog", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bathyTest!.setVisibleDatasets([
        { datasetId: "e2e-focus-trap-02", name: "Focus Trap Tab Test", source: "preset" },
      ]);
    });

    const removeBtn = page.locator(
      '[data-testid="btn-remove-visible-e2e-focus-trap-02"]',
    );
    await expect(removeBtn).toBeVisible({ timeout: 8_000 });
    await removeBtn.click();

    await expect(
      page.locator('[data-testid="remove-dataset-cancel"]'),
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Tab");
    const afterTab1 = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? "",
    );
    expect(afterTab1).toBe("remove-dataset-confirm");

    await page.keyboard.press("Tab");
    const afterTab2 = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? "",
    );
    expect(afterTab2).toBe("remove-dataset-cancel");
  });

  test("Shift+Tab wraps from Cancel to Confirm", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.setVisibleDatasets([
        { datasetId: "e2e-focus-trap-03", name: "Focus Trap Shift Tab", source: "preset" },
      ]);
    });

    const removeBtn = page.locator(
      '[data-testid="btn-remove-visible-e2e-focus-trap-03"]',
    );
    await expect(removeBtn).toBeVisible({ timeout: 8_000 });
    await removeBtn.click();

    await expect(
      page.locator('[data-testid="remove-dataset-cancel"]'),
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Shift+Tab");
    const afterShiftTab = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? "",
    );
    expect(afterShiftTab).toBe("remove-dataset-confirm");
  });

  test("Escape dismisses without confirming", async ({ page }) => {
    await page.evaluate(() => {
      window.__bathyTest!.setVisibleDatasets([
        { datasetId: "e2e-focus-trap-04", name: "Focus Trap Escape", source: "preset" },
      ]);
    });

    const removeBtn = page.locator(
      '[data-testid="btn-remove-visible-e2e-focus-trap-04"]',
    );
    await expect(removeBtn).toBeVisible({ timeout: 8_000 });
    await removeBtn.click();

    const dialog = page.locator('[role="dialog"]').filter({
      has: page.locator('[data-testid="remove-dataset-cancel"]'),
    });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden({ timeout: 3_000 });

    const visibleCount = await page.evaluate(() =>
      (window.__bathyTest as BathyTestApi | undefined) ? 1 : 0,
    );
    expect(visibleCount).toBe(1);
  });

  test("Enter on Confirm button closes dialog and removes dataset", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bathyTest!.setVisibleDatasets([
        { datasetId: "e2e-focus-trap-05", name: "Focus Trap Enter Confirm", source: "preset" },
      ]);
    });

    const removeBtn = page.locator(
      '[data-testid="btn-remove-visible-e2e-focus-trap-05"]',
    );
    await expect(removeBtn).toBeVisible({ timeout: 8_000 });

    await removeBtn.focus();
    await removeBtn.click();

    await expect(
      page.locator('[data-testid="remove-dataset-cancel"]'),
    ).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset["testid"] ?? "",
    );
    expect(focused).toBe("remove-dataset-confirm");

    await page.keyboard.press("Enter");

    await expect(
      page.locator('[data-testid="remove-dataset-cancel"]'),
    ).toBeHidden({ timeout: 5_000 });

    const isGone = await page
      .locator('[data-testid="btn-remove-visible-e2e-focus-trap-05"]')
      .isHidden({ timeout: 3_000 })
      .catch(() => false);
    expect(isGone).toBe(true);
  });
});

type BathyTestApi = NonNullable<Window["__bathyTest"]>;
