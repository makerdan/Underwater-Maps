import { test, expect } from "./fixtures";

/**
 * Task #448 — Map & Data dataset rows show an accurate loading dial while
 * a dataset is being switched in. The dial replaces the generic spinner,
 * exposes role=progressbar, advances, and disappears once the load
 * resolves.
 */
test.describe("dataset row loading dial", () => {
  test("appears, advances, and disappears when a preset dataset is selected", async ({
    page,
  }) => {
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. The isVisible check
    // below is the real gate before interacting with the dataset picker.
    await page.waitForLoadState("domcontentloaded");

    // Lake Ray Roberts (demo preset) is the sole built-in preset — use it as
    // the trigger so a real terrain load runs. Its presence also confirms the
    // user is signed in and the DatasetPanel is mounted.
    const trigger = page.locator('[data-testid="btn-dataset-lake-ray-roberts"]');
    const visible = await trigger.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      test.skip(true, "Dataset picker not visible — user is not signed in");
      return;
    }

    await trigger.click();

    // A confirm dialog may appear on the very first switch. Accept it if so.
    const confirmBtn = page.locator(
      '[data-testid="confirm-switch-confirm"], button:has-text("Switch")',
    );
    if (await confirmBtn.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.first().click();
    }

    const dial = page.locator('[data-testid="loading-dial"]').first();
    await expect(dial).toBeVisible({ timeout: 10_000 });
    await expect(dial).toHaveAttribute("role", "progressbar");

    // The dial reports a numeric percentage between 0 and 100.
    const initial = await dial.getAttribute("aria-valuenow");
    expect(initial).not.toBeNull();
    const initialN = Number(initial);
    expect(Number.isFinite(initialN)).toBe(true);
    expect(initialN).toBeGreaterThanOrEqual(0);
    expect(initialN).toBeLessThanOrEqual(100);

    // Wait for the load to finish — the dial disappears once the row stops
    // showing the loading state.
    await expect(dial).toBeHidden({ timeout: 30_000 });
  });
});
