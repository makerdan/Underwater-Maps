import { test, expect, type Page } from "@playwright/test";

/**
 * Slack-tide visuals end-to-end tests
 *
 * The slack-tide model is unit-tested on the server and inside the drift
 * physics, but the *visible* behaviour only lives in React components. This
 * spec locks down the three user-facing slack experiences so they cannot
 * silently regress:
 *
 *   1. The TidePanel slack status line shows a numeric "min" countdown when
 *      tidal data is available.
 *   2. The DriftTimeline shows the purple "◐ SLK" indicator on at least one
 *      hour chip when conditions are slack.
 *   3. The manual "SLACK NOW" override on the WeatherPanel updates the
 *      timeline's line-angle copy to "Line vertical — slack tide".
 *
 * Tests that depend on real NOAA tidal data skip cleanly when the data is
 * unavailable; the manual-override flow uses a mocked surface-conditions
 * response to force the override controls to render deterministically.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

async function clickTopBarToggle(page: Page, label: string): Promise<void> {
  const btn = page.locator(`button:has-text('${label}')`).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
}

/** Force the WeatherPanel into "estimated conditions" mode so the manual
 *  override controls (incl. SLACK NOW checkbox) render reliably regardless
 *  of whether Open-Meteo / NOAA are reachable from the test env. */
async function mockEstimatedSurfaceConditions(page: Page): Promise<void> {
  await page.route("**/api/surface-conditions*", async (route) => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      windSpeedKnots: 10,
      windDegrees: 180,
      tidalSpeedKnots: 1.2,
      tidalDegrees: 90,
      waveHeightM: 0.3,
      isSlack: false,
      phase: "flooding" as const,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hours,
        estimatedConditions: true,
        tidalDataSource: "estimated",
      }),
    });
  });
}

test.describe("Slack-tide visuals", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("TidePanel shows the slack status line with a numeric minute countdown", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }

    // Wait for terrain to load before opening the tidal overlay — the
    // TidePanel only fetches tide data once a dataset is active, and
    // toggling TIDAL before then leaves the panel in a loading state past
    // our visibility timeout.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()?.datasetId),
      null,
      { timeout: 20_000 },
    ).catch(() => {});

    // Enable the Tidal Overlay from the top-right toolbar.
    await clickTopBarToggle(page, "TIDAL");

    // Wait for the TidePanel to mount. It only renders once tidal data is
    // available for the dataset centre.
    const tidalHeader = page.locator("text=TIDAL OVERLAY").first();
    const noDataMessage = page.locator("text=/No tidal station within/").first();
    await expect(tidalHeader.or(noDataMessage)).toBeVisible({ timeout: 30_000 });

    if (await noDataMessage.isVisible().catch(() => false)) {
      test.skip(true, "No tidal station available for the default dataset in this env");
      return;
    }

    // The slack block renders one of two copies — both end with "<N> min".
    // Match either flooding/ebbing "slack in N min" or the active slack
    // "Next flow in N min" line.
    const slackLine = page
      .locator("text=/(slack in|Next flow in)\\s+\\d+\\s*min/i")
      .first();
    await expect(slackLine).toBeVisible({ timeout: 15_000 });
  });

  test("DriftTimeline shows '◐ SLK' on a chip when conditions are slack", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    // Force estimated conditions so the manual override panel renders.
    await mockEstimatedSurfaceConditions(page);

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });

    // Manual override panel must be present.
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Tick "SLACK NOW" and recompute the drift — all 24 hours will then have
    // isSlack=true, so every chip should display the SLK indicator.
    const slackNow = page.locator("input[type='checkbox']").first();
    await slackNow.check();
    await page.locator("button:has-text('COMPUTE DRIFT')").click();

    // At least one hour chip in the timeline must carry the SLK label.
    const slkChip = page.locator("text=/◐\\s*SLK/").first();
    await expect(slkChip).toBeVisible({ timeout: 10_000 });
  });

  test("Toggling 'SLACK NOW' updates the line-angle copy to 'Line vertical — slack tide'", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    await mockEstimatedSurfaceConditions(page);

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Baseline: timeline shows the angled-line copy ("N° from vertical").
    await expect(page.locator("text=LINE ANGLE")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("text=/\\d+°\\s*from vertical/").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Force slack, recompute, and assert the copy flips to the slack message.
    await page.locator("input[type='checkbox']").first().check();
    await page.locator("button:has-text('COMPUTE DRIFT')").click();

    await expect(
      page.locator("text=Line vertical — slack tide").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
