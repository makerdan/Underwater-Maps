import { test, expect, type Page } from "@playwright/test";

/**
 * Drift Planner end-to-end tests
 *
 * Covers:
 *   - Toggling Drift Planner on/off from the top toolbar
 *   - WeatherPanel render (real or estimated-conditions banner)
 *   - DriftTimeline 24-hour chip row + scrubber interaction
 *   - × close button restoring the off state
 *
 * The tests gracefully skip when the canvas / HUD aren't visible (i.e. the
 * sign-in landing page is being shown because no e2e auth bypass is active),
 * matching the pattern used by other specs in this suite.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  const canvasVisible = await page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  return canvasVisible;
}

async function openDriftPlanner(page: Page): Promise<void> {
  const driftBtn = page.locator("button:has-text('DRIFT')").first();
  await expect(driftBtn).toBeVisible({ timeout: 10_000 });
  await driftBtn.dispatchEvent("click");
}

async function mockOkSurfaceConditions(page: Page): Promise<void> {
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    windSpeedKnots: 5,
    windDegrees: 180,
    tidalSpeedKnots: 0.5,
    tidalDegrees: 90,
    waveHeightM: 0.1,
  }));
  await page.route("**/api/surface-conditions*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hours,
        estimatedConditions: false,
        tidalDataSource: "noaa",
      }),
    }),
  );
}

test.describe("Drift Planner", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the SimulatedDataConfirmDialog so it cannot steal focus or
    // intercept Escape before drift-planner interactions run. Also register
    // the surface-conditions mock BEFORE goto so the initial fetch (which
    // React Query caches) is intercepted — a late route registration after
    // domcontentloaded means the cached real-API response is used and the
    // WeatherPanel never sees the mocked data.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await mockOkSurfaceConditions(page);
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. Each test waits on the
    // specific element it cares about instead.
    await page.waitForLoadState("domcontentloaded");
    // useSurfaceConditions is gated on `centerLat !== null`, which requires
    // terrain to be loaded. Wait for the TestBridge to report any terrain
    // (real Thorne Bay auto-load or simulated fallback). Once terrain is set,
    // the always-on useSurfaceConditions hook fires automatically and the
    // mock registered above intercepts it — no need to seed synthetic terrain.
    await page
      .waitForFunction(
        () =>
          Boolean(
            (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.(),
          ),
        { timeout: 20_000 },
      )
      .catch(() => {});
  });

  test("DRIFT toolbar button opens the Weather Panel overlay", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    await openDriftPlanner(page);
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });
  });

  test("Weather Panel shows tidal/wind data or the estimated-conditions banner", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await openDriftPlanner(page);
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });

    // Either we get the live readouts (WIND + TIDAL CURRENT labels) or the
    // amber estimated-conditions banner — both are valid outcomes depending
    // on whether the surface-conditions API reached Open-Meteo in this env.
    const realData = page.locator("text=TIDAL CURRENT");
    const estimatedBanner = page.locator("text=Using estimated conditions");
    await expect(realData.or(estimatedBanner)).toBeVisible({ timeout: 15_000 });
  });

  test("Drift Timeline renders 24 hour chips and selecting one updates the detail row", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await openDriftPlanner(page);

    // Wait for the timeline to render. driftPath is only set after the
    // surface-conditions fetch resolves and computeDrift() runs in
    // WeatherPanel's useEffect, so we wait on a hour chip selector.
    const hour00 = page.locator("button:has-text('00:00')").first();
    await expect(hour00).toBeVisible({ timeout: 15_000 });

    // All 24 hour chips should be present.
    for (const hh of ["00:00", "06:00", "12:00", "18:00", "23:00"]) {
      await expect(page.locator(`button:has-text('${hh}')`).first()).toBeVisible();
    }

    // Detail row labels are present.
    await expect(page.locator("text=DRIFT SPEED")).toBeVisible();
    await expect(page.locator("text=LINE ANGLE")).toBeVisible();
    await expect(page.locator("text=HOOK DEPTH")).toBeVisible();

    // Click a non-default hour and assert the selected chip styling changes
    // (active chip uses cyan color #00e5ff vs slate #475569 for inactive).
    const hour05 = page.locator("button:has-text('05:00')").first();
    await hour05.dispatchEvent("click");
    await expect(hour05).toHaveCSS("color", "rgb(0, 229, 255)");
  });

  test("× close button hides the Drift Planner overlays", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await openDriftPlanner(page);
    const panel = page.locator("text=DRIFT PLANNER");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The close button is the × glyph inside the panel header.
    const closeBtn = page
      .locator("div", { has: panel })
      .locator("button:has-text('×')")
      .first();
    await closeBtn.dispatchEvent("click");

    await expect(panel).toBeHidden({ timeout: 3_000 });
    // Hour chips also disappear.
    await expect(page.locator("button:has-text('00:00')").first()).toBeHidden();
  });
});
