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
    test.setTimeout(30_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }

    // Wait for the TestBridge to register before injecting data. The bridge
    // is wired up in a useEffect that fires after the first render; on a
    // freshly navigated page this usually takes < 1 s, but we give it 10 s
    // to be safe under load.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest?.isTestBridgeReady?.()),
      null,
      { timeout: 10_000 },
    ).catch(() => {});

    // Inject tidal overlay + mock tidal data directly via the TestBridge
    // (bypassing the useTidalData fetch path and autoLoadTidal settings
    // hydration, both of which are too slow and unreliable in this env).
    // setTidalOverlay(true) → tidalOverlay = true in context
    // feedTidalData(…)      → tidalDataOverride = data in App state
    // Both cause a synchronous React re-render so TidePanel mounts
    // immediately on the next paint.
    await page.evaluate(() => {
      const bt = window.__bathyTest;
      if (!bt) return;
      bt.setTidalOverlay(true);
      bt.feedTidalData({
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
      });
    });

    // TidePanel renders once tidalOverlay=true AND effectiveTidalData!==null,
    // both of which we just set synchronously. Give React one tick to commit.
    const tidalMounted = page.locator("[data-testid='tide-panel']").first();
    await expect(tidalMounted).toBeVisible({ timeout: 5_000 });

    // The slack block renders "slack in 15 min" (isSlack:false, flooding).
    const slackLine = page
      .locator("text=/(slack in|Next flow in)\\s+\\d+\\s*min/i")
      .first();
    await expect(slackLine).toBeVisible({ timeout: 5_000 });
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

    // Seed synthetic terrain so useSurfaceConditions (gated on !!terrain)
    // fires the fetch and the mock returns estimatedConditions:true.
    await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });

    // Manual override panel must be present.
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Tick "SLACK NOW" via DOM el.click() on the checkbox input.
    //
    // Why not locator.click() / locator.check()?
    //   – The SLACK NOW label sits deep inside the scrollable WeatherPanel.
    //     Playwright's locator.click({ force:true }) bypasses actionability
    //     checks but still sends mouse events at the element's viewport
    //     coordinates, which are often outside the visible area when the
    //     panel is scrolled. The browser silently discards off-screen mouse
    //     events, so the click never reaches the element.
    //   – locator.check({ force:true }) fails in React 19 because React
    //     synchronously resets the controlled DOM value back to the prop
    //     before Playwright's post-check state assertion runs.
    //   – locator.dispatchEvent("click") dispatches a bare Event, not a
    //     MouseEvent with activation behaviour, so the checkbox toggle
    //     never fires and onChange receives e.target.checked === false.
    //
    // DOM .click() (called via page.evaluate) IS the native activation
    // method: it atomically toggles checked and fires the click+change
    // events with activation behaviour.  React's onChange handler reads
    // e.target.checked === true and calls setManualSlackNow(true) in the
    // Zustand store (sync).  We then poll until React has re-rendered the
    // controlled <input checked={manualSlackNow}> before clicking COMPUTE
    // DRIFT so the recomputeWithManual closure sees the updated value.
    await page.evaluate(() => {
      const cb = document.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement | null;
      if (cb) cb.click();
    });
    await page
      .waitForFunction(
        () =>
          (document.querySelector("input[type='checkbox']") as HTMLInputElement)
            ?.checked === true,
        null,
        { timeout: 3_000 },
      )
      .catch(() => {});
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

    // Seed synthetic terrain so useSurfaceConditions (gated on !!terrain)
    // fires the fetch and the mock returns estimatedConditions:true.
    await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});

    await clickTopBarToggle(page, "DRIFT");
    await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=MANUAL OVERRIDE")).toBeVisible({ timeout: 10_000 });

    // Baseline: timeline shows the angled-line copy ("N° from vertical").
    await expect(page.locator("text=LINE ANGLE")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("text=/\\d+°\\s*from vertical/").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Force slack via DOM el.click() on the checkbox input — same technique
    // as the SLK-chip test above. See that test for the full rationale.
    await page.evaluate(() => {
      const cb = document.querySelector(
        "input[type='checkbox']",
      ) as HTMLInputElement | null;
      if (cb) cb.click();
    });
    await page
      .waitForFunction(
        () =>
          (document.querySelector("input[type='checkbox']") as HTMLInputElement)
            ?.checked === true,
        null,
        { timeout: 3_000 },
      )
      .catch(() => {});
    await page.locator("button:has-text('COMPUTE DRIFT')").dispatchEvent("click");

    await expect(
      page.locator("text=Line vertical — slack tide").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
