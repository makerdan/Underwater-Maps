import { test, expect, type Page } from "./fixtures";

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

/**
 * Audit note (Task #303): every test in this file genuinely needs the home
 * route — all assertions target HUD overlay toggles (wind/tide/current) and
 * the Conditions Legend, both of which only mount on "/". The goto stays in
 * each test (no `beforeEach` goto to retire). What we DID retire is the
 * post-goto `waitForLoadState("networkidle")`: the heavy 3D home route runs
 * background terrain/datasets/tidal requests that rarely settle inside
 * Playwright's 30s network-idle window, and every test already waits on the
 * specific HUD element it asserts against (`expect(...).toBeVisible(...)`).
 * Dropping the redundant idle-wait shaves several seconds per test without
 * weakening any assertion.
 */
test.describe("Wind / Tide / Current overlays", () => {
  test.beforeEach(async ({ page }) => {
    // Reset overlay toggle localStorage so each test starts with all three
    // overlays OFF. Without this, the persistence test (which saves
    // windOverlayActive=true) poisons subsequent tests: a blind click on an
    // already-ON toggle turns it OFF instead of ON, producing the wrong
    // number of manual-override sliders (2 instead of 4) and breaking
    // the ESTIMATED badge assertion.
    //
    // IMPORTANT: addInitScript runs before EVERY navigation including reloads.
    // To avoid clearing localStorage on the reload inside the persistence
    // test, we use a sessionStorage flag as a "first-load-only" guard.
    // sessionStorage persists across page.reload() in the same tab session but
    // is fresh on each new page.goto() (new Playwright test context).
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("__overlayStateCleared")) {
        sessionStorage.setItem("__overlayStateCleared", "1");
        localStorage.removeItem("bathyscan:windOverlayActive");
        localStorage.removeItem("bathyscan:tideOverlayActive");
        localStorage.removeItem("bathyscan:currentOverlayActive");
      }
    });
  });
  test("each HUD toggle reveals the Conditions Legend with the right row", async ({
    page,
  }) => {
    await mockOkSurfaceConditions(page);
    await page.goto("/");

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (auth bypass inactive)");
      return;
    }

    // App.tsx mounts exactly one <ConditionsLegend />, pinned at the bottom
    // of the left sidebar (below the Currents panel).
    const legend = page.locator("[data-testid='conditions-legend']");
    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    const curBtn = page.locator("[data-testid='overlay-toggle-current']");

    await expect(windBtn).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("[data-testid='conditions-legend']"),
    ).toHaveCount(0);

    // Wind on → legend with Wind row.
    await page.locator("[data-testid='overlay-toggle-wind']").dispatchEvent("click");
    await expect(windBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend).toBeVisible({ timeout: 10_000 });
    await expect(legend.locator("text=Wind").first()).toBeVisible();

    // Tide on → Tide row joins.
    await page.locator("[data-testid='overlay-toggle-tide']").dispatchEvent("click");
    await expect(tideBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend.locator("text=Tide")).toBeVisible();

    // Current on → Current row joins.
    await page.locator("[data-testid='overlay-toggle-current']").dispatchEvent("click");
    await expect(curBtn).toHaveAttribute("aria-pressed", "true");
    await expect(legend.locator("text=Current")).toBeVisible();

    // Turning everything off hides the legend.
    await page.locator("[data-testid='overlay-toggle-wind']").dispatchEvent("click");
    await page.locator("[data-testid='overlay-toggle-tide']").dispatchEvent("click");
    await page.locator("[data-testid='overlay-toggle-current']").dispatchEvent("click");
    await expect(
      page.locator("[data-testid='conditions-legend']"),
    ).toHaveCount(0);
  });

  test("overlay toggle state persists across a page reload", async ({ page }) => {
    await mockOkSurfaceConditions(page);
    await page.goto("/");

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    const curBtn = page.locator("[data-testid='overlay-toggle-current']");

    await expect(windBtn).toBeVisible({ timeout: 10_000 });
    await page.locator("[data-testid='overlay-toggle-wind']").dispatchEvent("click");
    await page.locator("[data-testid='overlay-toggle-tide']").dispatchEvent("click");
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
    // No networkidle wait — the explicit `expect(windBtn2).toBeVisible`
    // below auto-waits on the specific HUD element we assert against, and
    // the 3D home route rarely reaches idle inside Playwright's budget.

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

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    const windBtn = page.locator("[data-testid='overlay-toggle-wind']");
    const tideBtn = page.locator("[data-testid='overlay-toggle-tide']");
    await expect(windBtn).toBeVisible({ timeout: 10_000 });

    // Turn on Wind and Tide so both manual-override sections render.
    await page.locator("[data-testid='overlay-toggle-wind']").dispatchEvent("click");
    await page.locator("[data-testid='overlay-toggle-tide']").dispatchEvent("click");

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
