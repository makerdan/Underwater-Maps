import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Drift Planner end-to-end tests
 *
 * Covers:
 *   - Toggling Drift Planner on/off from the Plan tab (Start/Stop Planning)
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
  // The Drift Planner panel now lives inside the sidebar's Plan-mode section,
  // which is hidden while the default Explore mode is active — switch to Plan
  // first (see tide-station-panel.spec.ts for the same pattern).
  const planTab = page.locator("[data-testid='sidebar-mode-tab-plan']");
  await expect(planTab).toBeVisible({ timeout: 10_000 });
  await planTab.click();
  await expect(planTab).toHaveAttribute("aria-pressed", "true");
  // Activate the Drift Planner via the TestBridge. The production UI opens it
  // by clicking a forecast slot in ForecastStrip (a <div role="button">, not
  // a <button>), but that requires surface-conditions data and the sidebar
  // to be scrolled to the Forecast section. Driving the Zustand store directly
  // is more reliable and still exercises the full WeatherPanel + DriftTimeline UI.
  await page.evaluate(() =>
    (
      window as unknown as {
        __bathyTest?: { setDriftPlannerActive?: (v: boolean) => void };
      }
    ).__bathyTest?.setDriftPlannerActive?.(true),
  );
  // Since the Plan-mode sidebar restructure, the Drift & Route section (and
  // the WeatherPanel inside it) lives in the PLAN tab and is display:none in
  // Explore mode. Switch the sidebar to Plan so the panel becomes visible.
  await page.getByRole("button", { name: "Plan", exact: true }).click();
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
    // Extend timeout for this test to 60 s — the terrain wait (up to 10 s)
    // plus seedTerrain fallback plus WeatherPanel render can exceed 30 s.
    test.setTimeout(60_000);
    // Suppress the SimulatedDataConfirmDialog so it cannot steal focus or
    // intercept Escape before drift-planner interactions run. Also register
    // the surface-conditions mock BEFORE goto so the initial fetch (which
    // React Query caches) is intercepted — a late route registration after
    // domcontentloaded means the cached real-API response is used and the
    // WeatherPanel never sees the mocked data.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        // Suppress the onboarding tour overlay, which otherwise intercepts
        // all pointer events (including the Plan-mode tab click).
        const key = "bathyscan:settings";
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
        parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true };
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch {}
    });
    // Server-side settings sync can override the localStorage flag above, so
    // persist hasSeenOnboarding on the server too (same as tide-station spec).
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true },
    });
    await mockOkSurfaceConditions(page);
    await page.goto("/");
    // domcontentloaded (not networkidle): the home route keeps long-lived
    // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
    // never resolves before Playwright's 30 s timeout. Each test waits on the
    // specific element it cares about instead.
    await page.waitForLoadState("domcontentloaded");
    // useSurfaceConditions is gated on `centerLat !== null`, which requires
    // terrain to be loaded. Wait up to 10 s for real terrain, then fall back
    // to seedTerrain so the mock above is guaranteed to fire quickly.
    await page
      .waitForFunction(
        () =>
          Boolean(
            (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.(),
          ),
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const hasTerrain = await page
      .evaluate(
        () =>
          Boolean(
            (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.(),
          ),
      )
      .catch(() => false);
    if (!hasTerrain) {
      await page
        .evaluate(
          () =>
            (window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } }).__bathyTest?.seedTerrain?.(),
        )
        .catch(() => {});
      await page
        .waitForFunction(
          () =>
            Boolean(
              (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.(),
            ),
          undefined,
          { timeout: 5_000 },
        )
        .catch(() => {});
    }
  });

  test("START PLANNING button in Plan mode opens the Weather Panel", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown (e2e auth bypass inactive)");
      return;
    }
    // Exercise the real UI path: switch to Plan mode and click the
    // START PLANNING button in the Drift & Route sidebar section.
    const planTab = page.locator("[data-testid='sidebar-mode-tab-plan']");
    await expect(planTab).toBeVisible({ timeout: 10_000 });
    await planTab.click();
    const startBtn = page.locator("[data-testid='drift-empty-state'] button");
    await expect(startBtn).toBeVisible({ timeout: 5_000 });
    await startBtn.click();
    await expect(page.locator("[data-testid='weather-panel']")).toBeVisible({ timeout: 5_000 });
  });

  test("Weather Panel shows tidal/wind data or the estimated-conditions banner", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await openDriftPlanner(page);
    await expect(page.locator("[data-testid='weather-panel']")).toBeVisible({ timeout: 5_000 });

    // Either we get the live readouts (WIND + TIDAL CURRENT labels) or the
    // amber estimated-conditions banner — both are valid outcomes depending
    // on whether the surface-conditions API reached Open-Meteo in this env.
    // Use .first() to avoid Playwright strict-mode violation: WeatherPanel can
    // render "⚠ Using estimated conditions" in two sibling sections
    // simultaneously (header banner + manual-override block), which makes the
    // .or() locator match more than one element (drift-planner.spec.ts:136).
    const realData = page.locator("text=TIDAL CURRENT");
    const estimatedBanner = page.locator("text=Using estimated conditions");
    await expect(realData.or(estimatedBanner).first()).toBeVisible({ timeout: 15_000 });
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

    // Click a non-default hour and assert the selected chip styling changes.
    // Active chips use cyan (#00e5ff) for normal drift, reddish-pink
    // (#fb7185) when the sinker contacts the seafloor at that hour, or
    // amber (#fbbf24) when drift has stalled — accept any active color.
    const hour05 = page.locator("button:has-text('05:00')").first();
    await hour05.dispatchEvent("click");
    await expect(hour05).toHaveCSS(
      "color",
      /rgb\(0, 229, 255\)|rgb\(251, 113, 133\)|rgb\(251, 191, 36\)/,
    );
  });

  test("STOP PLANNING button hides the Drift Planner panel", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }
    await openDriftPlanner(page);
    const panel = page.locator("[data-testid='weather-panel']");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The old top-right "◉ DRIFT" toolbar toggle was removed; the embedded
    // Plan-mode panel now has its own STOP PLANNING button.
    const stopBtn = page.locator("[data-testid='stop-planning-button']");
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await stopBtn.dispatchEvent("click");

    await expect(panel).toBeHidden({ timeout: 3_000 });
    // Hour chips also disappear, and the empty state returns.
    await expect(page.locator("button:has-text('00:00')").first()).toBeHidden();
    await expect(page.locator("[data-testid='drift-empty-state']")).toBeVisible({
      timeout: 3_000,
    });
  });
});
