import { test, expect, type Page } from "@playwright/test";

/**
 * Always-on Wind / Tide / Current overlays
 *
 * Locks down the three HUD toggle buttons added in task #116:
 *   - Each toggle reveals the Conditions Legend with the expected row.
 *   - Toggle state persists across a reload (localStorage).
 *   - When the surface-conditions API fails, the ESTIMATED badge appears
 *     along with the manual override sliders.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

/**
 * Strip Vite's HMR error overlay if it's been left in the DOM. Some non-fatal
 * runtime warnings inject a `<vite-error-overlay>` that intercepts pointer
 * events even though the app rendered successfully. Removing it lets clicks
 * reach the HUD buttons.
 */
async function clearViteOverlay(page: Page): Promise<void> {
  // Install a MutationObserver that strips the overlay on every reinjection
  // (HMR can re-add it on follow-up updates).
  await page.evaluate(() => {
    const strip = () =>
      document
        .querySelectorAll("vite-error-overlay")
        .forEach((el) => el.remove());
    strip();
    const obs = new MutationObserver(strip);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    (window as unknown as { __viteOverlayObs?: MutationObserver }).__viteOverlayObs = obs;
  });
}

/**
 * Click a button by data-testid via a synthetic DOM event. This sidesteps
 * the `vite-error-overlay` element, which Vite mounts on transient HMR
 * warnings and which intercepts real mouse pointer events even after we
 * try to remove it from the DOM.
 */
async function clickTestId(page: Page, testid: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`No element matching ${sel}`);
    el.click();
  }, `[data-testid='${testid}']`);
}

async function failSurfaceConditions(page: Page): Promise<void> {
  await page.route("**/api/surface-conditions*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "forced failure for test" }),
    }),
  );
}

async function mockOkSurfaceConditions(page: Page): Promise<void> {
  await page.route("**/api/surface-conditions*", (route) => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      windSpeedKnots: 8,
      windDegrees: 200,
      tidalSpeedKnots: 0.9,
      tidalDegrees: 120,
      waveHeightM: 0.4,
      isSlack: false,
      phase: "flooding" as const,
    }));
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hours,
        estimatedConditions: false,
        tidalDataSource: "noaa",
      }),
    });
  });
}

test.describe("Wind / Tide / Current overlays", () => {
  test("each HUD toggle reveals the Conditions Legend with the right row", async ({
    page,
  }) => {
    await mockOkSurfaceConditions(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (auth bypass inactive)");
      return;
    }
    await clearViteOverlay(page);

    // App.tsx mounts exactly one <ConditionsLegend />, bottom-left above the
    // HUD speed panel.
    const legend = page.locator("[data-testid='conditions-legend']");
    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    const curBtn = page.locator("[data-testid='overlay-toggle-current']");

    await expect(windBtn).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("[data-testid='conditions-legend']"),
    ).toHaveCount(0);

    // Wind on → legend with Wind row.
    await clickTestId(page, "overlay-toggle-wind");
    await expect(windBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend).toBeVisible({ timeout: 10_000 });
    await expect(legend.locator("text=Wind")).toBeVisible();

    // Tide on → Tide row joins.
    await clickTestId(page, "overlay-toggle-tide");
    await expect(tideBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend.locator("text=Tide")).toBeVisible();

    // Current on → Current row joins.
    await clickTestId(page, "overlay-toggle-current");
    await expect(curBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend.locator("text=Current")).toBeVisible();

    // Turning everything off hides the legend.
    await clickTestId(page, "overlay-toggle-wind");
    await clickTestId(page, "overlay-toggle-tide");
    await clickTestId(page, "overlay-toggle-current");
    await expect(
      page.locator("[data-testid='conditions-legend']"),
    ).toHaveCount(0);
  });

  test("overlay toggle state persists across a page reload", async ({ page }) => {
    await mockOkSurfaceConditions(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await clearViteOverlay(page);

    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    const curBtn = page.locator("[data-testid='overlay-toggle-current']");

    await expect(windBtn).toBeVisible({ timeout: 10_000 });
    await clickTestId(page, "overlay-toggle-wind");
    await clickTestId(page, "overlay-toggle-tide");
    // Leave current off so we can verify mixed state survives the reload.

    await expect(windBtn).toHaveAttribute("aria-pressed", "true");
    await expect(tideBtn).toHaveAttribute("aria-pressed", "true");
    await expect(curBtn).toHaveAttribute("aria-pressed", "false");

    // Verify the persisted keys are what the app reads on reload. The
    // uiStore only writes when a setter is called, so the never-touched
    // "current" key may be null (its default is `false`).
    const stored = await page.evaluate(() => ({
      wind: localStorage.getItem("bathyscan:windOverlayActive"),
      tide: localStorage.getItem("bathyscan:tideOverlayActive"),
      cur: localStorage.getItem("bathyscan:currentOverlayActive"),
    }));
    expect(stored.wind).toBe("true");
    expect(stored.tide).toBe("true");
    expect(stored.cur === null || stored.cur === "false").toBe(true);

    await page.reload();
    await page.waitForLoadState("networkidle");

    const windBtn2 = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn2 = page.locator("[data-testid='overlay-toggle-tide']");
    const curBtn2 = page.locator("[data-testid='overlay-toggle-current']");
    await expect(windBtn2).toBeVisible({ timeout: 10_000 });
    await expect(windBtn2).toHaveAttribute("aria-pressed", "true");
    await expect(tideBtn2).toHaveAttribute("aria-pressed", "true");
    await expect(curBtn2).toHaveAttribute("aria-pressed", "false");

    // Legend stays visible after reload because two overlays are still on.
    await expect(
      page.locator("[data-testid='conditions-legend']"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("failed surface-conditions API shows the ESTIMATED badge and manual sliders", async ({
    page,
  }) => {
    await failSurfaceConditions(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await clearViteOverlay(page);

    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    await expect(windBtn).toBeVisible({ timeout: 10_000 });

    // Turn on Wind and Tide so both manual-override sections render.
    await clickTestId(page, "overlay-toggle-wind");
    await clickTestId(page, "overlay-toggle-tide");

    const legend = page.locator("[data-testid='conditions-legend']");
    await expect(legend).toBeVisible({ timeout: 10_000 });

    // ESTIMATED badge appears (React Query may retry once before settling).
    await expect(legend.locator("text=ESTIMATED")).toBeVisible({
      timeout: 15_000,
    });

    // Manual override section + at least two range sliders (wind speed + dir,
    // tidal speed + dir — four total when both overlays are on).
    await expect(legend.locator("text=Manual Override")).toBeVisible();
    const sliders = legend.locator("input[type='range']");
    await expect(sliders).toHaveCount(4);
  });
});
