import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * NOAA tide-prediction station panel end-to-end tests
 *
 * The panel resolves the nearest NOAA station for the active dataset
 * centroid (GET /api/tides/station), loads a 31-day window of 6-minute
 * predictions (GET /api/tides/:stationId), and renders:
 *   - the station name/id + distance, with a caveat when > 30 miles away
 *   - a real-time interpolated "Tide now" height in feet MLLW
 *   - a trip-planning day picker, SVG tide curve, and time scrubber
 *
 * Both /api/tides endpoints are mocked so the test is deterministic and
 * independent of live NOAA reachability.
 */

const STATION_ID = "9450460";

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

/** 3 days of synthetic 6-minute sinusoidal predictions starting at today's
 *  UTC midnight, with a 31-day window advertised so the day picker enables
 *  its next-day arrow. */
function buildMockPredictions() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const predictions: Array<{ t: string; v: number }> = [];
  for (let i = 0; i < 3 * 240; i++) {
    const tMs = startMs + i * 6 * 60_000;
    // Semi-diurnal-ish curve, range about -1 … +9 ft.
    const v = 4 + 5 * Math.sin((2 * Math.PI * i) / 124);
    predictions.push({ t: new Date(tMs).toISOString(), v: Number(v.toFixed(3)) });
  }
  return {
    stationId: STATION_ID,
    datum: "MLLW",
    units: "feet",
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(startMs + 31 * 86_400_000).toISOString(),
    predictions,
  };
}

test.describe("Tide station prediction panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        // Suppress the onboarding tour overlay, which otherwise intercepts
        // all pointer events (including the plan-mode tab click below).
        const key = "bathyscan:settings";
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
        parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true };
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch {}
    });
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { showTidePanel: true, autoLoadTidal: true, hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true },
    });
    // Nearest-station lookup → a station 42 miles away so the distance
    // caveat renders alongside the normal station metadata.
    await page.route("**/api/tides/station*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          station: {
            id: STATION_ID,
            name: "Ketchikan",
            lat: 55.3319,
            lon: -131.6261,
            distanceMiles: 42.7,
          },
        }),
      });
    });
    // 31-day prediction window for that station.
    await page.route(`**/api/tides/${STATION_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildMockPredictions()),
      });
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
  });

  test("shows station, distance caveat, live height, and planning scrubber", async ({ page }) => {
    test.setTimeout(90_000);
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }

    await page.waitForFunction(
      () => Boolean(window.__bathyTest?.isTestBridgeReady?.()),
      null,
      { timeout: 10_000 },
    ).catch(() => {});

    // Seed terrain (sets a dataset centroid) and enable the tidal overlay —
    // this triggers the App effect that resolves the nearest tide station.
    await page.evaluate(() => {
      const bt = window.__bathyTest;
      if (!bt) return;
      bt.seedTerrain();
      bt.setTidalOverlay(true);
    });

    // The Conditions section lives in the sidebar's Plan mode — switch to it
    // (the default mode is Explore, which hides the plan sections).
    const planTab = page.locator("[data-testid='sidebar-mode-tab-plan']");
    await expect(planTab).toBeVisible({ timeout: 10_000 });
    await planTab.click();
    await expect(planTab).toHaveAttribute("aria-pressed", "true");

    // Panel mounts with the mocked station metadata.
    const panel = page.locator("[data-testid='tide-station-panel']");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid='tide-station-name']")).toContainText(
      "Ketchikan",
      { timeout: 10_000 },
    );
    await expect(page.locator("[data-testid='tide-station-name']")).toContainText(
      `#${STATION_ID}`,
    );

    // > 30-mile accuracy caveat.
    await expect(
      page.locator("[data-testid='tide-station-distance-caveat']"),
    ).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText("42.7 mi");

    // Real-time mode: interpolated height in feet MLLW.
    const height = page.locator("[data-testid='tide-station-height']");
    await expect(height).toBeVisible({ timeout: 10_000 });
    await expect(height).toContainText(/[-+]\d+\.\d{2} ft/);
    await expect(panel).toContainText("Tide now");

    // Trip-planning widgets: day picker, SVG curve, time scrubber.
    await expect(page.locator("[data-testid='tide-curve']")).toBeVisible();
    const scrubber = page.locator("[data-testid='tide-time-scrubber']");
    await expect(scrubber).toBeVisible();

    // Scrub to noon on the selected day → panel switches to planning mode.
    await scrubber.fill("720");
    await expect(panel).toContainText("Planned tide", { timeout: 5_000 });
    await expect(
      page.locator("[data-testid='tide-station-back-to-now']"),
    ).toBeVisible();

    // Advance one day with the day picker; the day label changes.
    const label = page.locator("[data-testid='tide-day-label']");
    const before = await label.textContent();
    await page.locator("[data-testid='tide-day-next']").click();
    await expect(label).not.toHaveText(before ?? "", { timeout: 5_000 });

    // Back to live mode via the NOW button.
    await page.locator("[data-testid='tide-station-back-to-now']").click();
    await expect(panel).toContainText("Tide now", { timeout: 5_000 });
  });
});
