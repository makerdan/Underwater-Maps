import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

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
  // Use dispatchEvent to bypass any canvas element that may sit on top of
  // the toolbar button in headless mode (z-order intercept).
  await btn.dispatchEvent("click");
}

/** Force the WeatherPanel into "estimated conditions" mode so the manual
 *  override controls (incl. SLACK NOW checkbox) render reliably regardless
 *  of whether Open-Meteo / NOAA are reachable from the test env. Uses the
 *  same hour-object shape that WeatherPanel parses (windSpeed/windDir/
 *  currentSpeed/currentDir) so fields aren't silently undefined. */
async function mockEstimatedSurfaceConditions(page: Page): Promise<void> {
  await page.route("**/api/surface-conditions*", async (route) => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      time: `2025-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
      windSpeed: 10,
      windDir: 180,
      currentSpeed: 1.2,
      currentDir: 90,
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
    // Suppress the SimulatedDataConfirmDialog before navigating so it cannot
    // block clicks or intercept keyboard events during tests.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    // Ensure showTidePanel / autoLoadTidal are enabled on the server so they
    // don't get overwritten by a prior test that disabled them.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { showTidePanel: true, autoLoadTidal: true },
    });
    // Mock the live tidal endpoint BEFORE navigating so useTidalData picks up
    // the stub on the very first fetch. Without this, TidePanel may never
    // mount if the real NOAA station lookup times out or returns no station.
    await page.route(/\/api\/tidal(\?|$)/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          tideHeight: 1.23,
          currentDirection: 90,
          currentSpeed: 0.8,
          stationName: "Mock Station",
          stationId: "MOCK1",
          isPredicted: true,
          source: "estimated",
          nextEvent: {
            type: "high",
            time: new Date(Date.now() + 60 * 60_000).toISOString(),
            height: 1.5,
          },
          slack: {
            isSlack: false,
            phase: "flooding",
            minutesToSlack: 15,
            minutesSinceSlack: 0,
            nextReversalAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        }),
      });
    });
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. Tests wait on specific
    // elements below instead.
    await page.waitForLoadState("domcontentloaded");
  });

  test("TidePanel shows the slack status line with a numeric minute countdown", async ({ page }) => {
    test.setTimeout(90_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }

    // Wait for terrain to load before opening the tidal overlay — the
    // TidePanel only fetches tide data once a dataset is active, and
    // toggling TIDAL before then leaves the panel in a loading state past
    // our visibility timeout.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
      null,
      { timeout: 20_000 },
    ).catch(() => {});
    // If terrain didn't load in time, seed synthetic terrain so that
    // useTidalData receives non-null lat/lon and fires the fetch.
    const hasTerrain = await page.evaluate(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
    ).catch(() => false);
    if (!hasTerrain) {
      const seeded = await page.evaluate(
        () => window.__bathyTest?.seedTerrain?.(),
      ).catch(() => false);
      // Wait for the seeded terrain to actually propagate into app state.
      if (seeded) {
        await page.waitForFunction(
          () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
          null,
          { timeout: 5_000 },
        ).catch(() => {});
      } else {
        await page.waitForTimeout(500);
      }
    }

    // Enable the Tidal Overlay only if it is not already on.
    // autoLoadTidal:true causes the app to activate the overlay on first
    // render; clicking an already-active button would toggle it *off* and
    // prevent TidePanel from ever mounting.
    const tidalBtn = page.locator("button:has-text('TIDAL')").first();
    await expect(tidalBtn).toBeVisible({ timeout: 10_000 });
    const tidalBtnText = (await tidalBtn.innerText()).trim();
    if (!tidalBtnText.startsWith("◉")) {
      await tidalBtn.dispatchEvent("click");
    }

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
    test.setTimeout(60_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    // Register mock BEFORE reloading so the fresh initial fetch (and React
    // Query's cache entry) returns estimatedConditions:true. Without a
    // reload the cache from the beforeEach goto may already hold real-API
    // data (estimatedConditions:false) and the WeatherPanel uses it from
    // cache without re-fetching, meaning MANUAL OVERRIDE never renders.
    await mockEstimatedSurfaceConditions(page);
    await page.reload({ waitUntil: "domcontentloaded" });

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });

    // Manual override panel must be present.
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Tick "SLACK NOW" and recompute the drift — all 24 hours will then have
    // isSlack=true, so every chip should display the SLK indicator.
    const slackNow = page.locator("input[type='checkbox']").first();
    await slackNow.check({ force: true });
    await page.locator("button:has-text('COMPUTE DRIFT')").dispatchEvent("click");

    // At least one hour chip in the timeline must carry the SLK label.
    const slkChip = page.locator("text=/◐\\s*SLK/").first();
    await expect(slkChip).toBeVisible({ timeout: 10_000 });
  });

  test("Toggling 'SLACK NOW' updates the line-angle copy to 'Line vertical — slack tide'", async ({ page }) => {
    test.setTimeout(60_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    // Same reload pattern as the SLK-chip test: set mock first, reload so
    // the initial surface-conditions fetch is intercepted and cached.
    await mockEstimatedSurfaceConditions(page);
    await page.reload({ waitUntil: "domcontentloaded" });

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Baseline: timeline shows the angled-line copy ("N° from vertical").
    await expect(page.locator("text=LINE ANGLE")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("text=/\\d+°\\s*from vertical/").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Force slack, recompute, and assert the copy flips to the slack message.
    await page.locator("input[type='checkbox']").first().check({ force: true });
    await page.locator("button:has-text('COMPUTE DRIFT')").dispatchEvent("click");

    await expect(
      page.locator("text=Line vertical — slack tide").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
