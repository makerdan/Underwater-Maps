import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * E2E tests — LocationBadge on all five data panels
 *
 * The location context badge (data-testid="location-badge") was added to every
 * panel that samples weather/tide data from a dataset centre. This spec locks
 * down two things per panel:
 *
 *   1. The badge is present and carries data-state="ready" once data has loaded
 *      (showing dataset name + lat/lon coordinates).
 *   2. The badge carries data-state="loading" and text "Updating…" while the
 *      panel's primary data fetch is still in-flight.
 *
 * Panel coverage:
 *   • ForecastStrip      — sidebar-section-forecast
 *   • ConditionsLegend   — data-testid="conditions-legend" (wind overlay active)
 *   • TidePanel embedded — data-testid="tide-panel" (tidal overlay active)
 *   • WeatherPanel       — data-testid="weather-panel" (Drift Planner open)
 *
 * The TidePanel loading state is tested by triggering a scrubDatetime change
 * (day button click) while the subsequent tidal API call is held in-flight.
 * useTidalData keeps the previous data during a re-fetch, so TidePanel stays
 * mounted with loading=true — deterministically producing the loading badge.
 *
 * The TidePanel badge wiring across embedded and standalone rendering modes is
 * additionally covered at unit-test level in TidePanelBadge.test.tsx.
 *
 * All tests gracefully skip when the e2e auth bypass is inactive.
 */

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

/** Mock surface-conditions to return a clean ready response immediately. */
async function mockReadySurfaceConditions(page: Page): Promise<void> {
  const hours = Array.from({ length: 48 }, (_, h) => ({
    hour: h,
    windSpeedKnots: 7,
    windDegrees: 200,
    tidalSpeedKnots: 0.8,
    tidalDegrees: 130,
    waveHeightM: 0.35,
    isSlack: false,
    phase: "flooding" as const,
    tideRising: true,
  }));
  await page.route("**/api/surface-conditions*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        forecast48h: hours,
        hours: hours.slice(0, 24),
        estimatedConditions: false,
        tidalDataSource: "noaa",
        tidalStationName: "Mock Station",
        tidalStationId: "MOCK01",
        tidalStationDistanceKm: 3.2,
      }),
    }),
  );
}

/**
 * Mock surface-conditions to stall indefinitely (never resolve).
 * Used to hold the badge in loading state long enough to assert on it.
 */
async function mockStallingSurfaceConditions(page: Page): Promise<void> {
  await page.route("**/api/surface-conditions*", (_route) => {
    // Deliberately do nothing — route never fulfills so useSurfaceConditions
    // stays in isLoading=true for the duration of the test.
  });
}

/**
 * Build a tidal route that:
 *   - Responds immediately on the first call (so TidePanel can mount).
 *   - Stalls on all subsequent calls (keeping loading=true while old data stays).
 * This exploits the fact that useTidalData preserves the previous `data` value
 * during a re-fetch, so TidePanel stays mounted with tidalLoading=true.
 */
async function mockTidalFirstFastThenStall(page: Page): Promise<() => void> {
  // NOTE: with the tide overlay active, App.tsx passes timelineStore.currentTime
  // (always a Date, never null) as scrubDatetime, so EVERY tidal fetch carries a
  // datetime= param — a "datetime means re-fetch" heuristic stalls the initial
  // fetch too and TidePanel never mounts. Instead, fulfill every call until the
  // test flips the stall flag (right before clicking "Tomorrow").
  const state = { stall: false };
  await page.route(/\/api\/tidal(\?|$)/, async (route) => {
    if (!state.stall) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          tideHeight: 1.1,
          currentDirection: 90,
          currentSpeed: 0.6,
          stationName: "Mock NOAA Station",
          stationId: "MOCK01",
          isPredicted: false,
          source: "noaa",
          nextEvent: {
            type: "high",
            time: new Date(Date.now() + 3_600_000).toISOString(),
            height: 1.5,
          },
          slack: {
            isSlack: false,
            phase: "flooding",
            minutesToSlack: 45,
            minutesSinceSlack: 0,
            nextReversalAt: new Date(Date.now() + 45 * 60_000).toISOString(),
          },
        }),
      });
    }
    // stall=true: do nothing — route stalls, keeping loading=true
  });
  return () => {
    state.stall = true;
  };
}

/** Mock the tidal data endpoint to respond immediately (for non-loading tests). */
async function mockTidalDataReady(page: Page): Promise<void> {
  await page.route(/\/api\/tidal(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        tideHeight: 1.1,
        currentDirection: 90,
        currentSpeed: 0.6,
        stationName: "Mock NOAA Station",
        stationId: "MOCK01",
        isPredicted: false,
        source: "noaa",
        nextEvent: {
          type: "high",
          time: new Date(Date.now() + 3_600_000).toISOString(),
          height: 1.5,
        },
        slack: {
          isSlack: false,
          phase: "flooding",
          minutesToSlack: 45,
          minutesSinceSlack: 0,
          nextReversalAt: new Date(Date.now() + 45 * 60_000).toISOString(),
        },
      }),
    }),
  );
}

/**
 * Wait for the app's TestBridge to report any terrain loaded.
 * Falls back to seeding synthetic terrain when auto-load takes too long.
 */
async function ensureTerrainLoaded(page: Page): Promise<void> {
  type BathyWindow = {
    __bathyTest?: {
      getTerrainSummary?: () => unknown;
      seedTerrain?: () => unknown;
      isTestBridgeReady?: () => boolean;
    };
  };

  // Wait up to 10s for terrain to auto-load from a saved dataset in localStorage.
  // Shorter than the previous 25s — if no dataset is saved the auto-load will
  // never fire, so failing fast lets us seed synthetic terrain sooner.
  await page
    .waitForFunction(
      () => Boolean((window as unknown as BathyWindow).__bathyTest?.getTerrainSummary?.()),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});

  const hasTerrain = await page
    .evaluate(() => Boolean((window as unknown as BathyWindow).__bathyTest?.getTerrainSummary?.()))
    .catch(() => false);

  if (!hasTerrain) {
    // Retry seeding a few times in case the TestBridge useEffect registration
    // is still settling (the seedTerrain function returns false when
    // appSetTerrain is not yet registered).
    let seeded = false;
    for (let attempt = 0; attempt < 4 && !seeded; attempt++) {
      if (attempt > 0) {
        await page.waitForTimeout(500).catch(() => {});
      }
      seeded = Boolean(
        await page
          .evaluate(() => (window as unknown as BathyWindow).__bathyTest?.seedTerrain?.())
          .catch(() => false),
      );
    }
    if (seeded) {
      await page
        .waitForFunction(
          () => Boolean((window as unknown as BathyWindow).__bathyTest?.getTerrainSummary?.()),
          undefined,
          { timeout: 8_000 },
        )
        .catch(() => {});
    } else {
      await page.waitForTimeout(500).catch(() => {});
    }
  }
}

/**
 * Switch the sidebar to the Plan tab. The sidebar restructure moved
 * ForecastStrip, TidePanel, and the embedded WeatherPanel (Drift Planner)
 * into the Plan tab — inactive tabs render display:none, so their panels
 * are hidden until the tab is selected.
 */
async function ensurePlanTab(page: Page): Promise<void> {
  const planTab = page.locator("[data-testid='sidebar-mode-tab-plan']");
  await expect(planTab).toBeVisible({ timeout: 10_000 });
  const pressed = await planTab.getAttribute("aria-pressed").catch(() => null);
  if (pressed !== "true") {
    await planTab.dispatchEvent("click");
    await expect(planTab).toHaveAttribute("aria-pressed", "true");
  }
}

/** Enable the tidal overlay toggle if not already on. */
async function ensureTidalOverlayOn(page: Page): Promise<void> {
  // The tidal-overlay-toggle lives inside the OverlaysToolsPanel body, which is
  // conditionally rendered when the Radix Collapsible is open.  If a prior test
  // left the panel collapsed the toggle is CSS-hidden even though the locator
  // resolves.  Expand the panel first when the toggle is not yet visible.
  const btn = page.locator("[data-testid='tidal-overlay-toggle']").first();
  const isVisible = await btn.isVisible().catch(() => false);
  if (!isVisible) {
    // Look for the OverlaysToolsPanel header trigger (Radix Collapsible button
    // with aria-expanded="false") and click it to open the panel body.
    const panelTrigger = page
      .locator("[data-testid='overlays-tools-panel']")
      .locator("button[aria-expanded='false']")
      .first();
    if (await panelTrigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await panelTrigger.dispatchEvent("click");
    }
  }
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await page
    .waitForFunction(
      () =>
        document
          .querySelector("[data-testid='tidal-overlay-toggle']")
          ?.getAttribute("aria-pressed") === "true",
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
  const pressed = await btn.getAttribute("aria-pressed").catch(() => null);
  if (pressed !== "true") {
    await btn.dispatchEvent("click");
  }
}

/** Enable a HUD overlay toggle (wind / tide / current) if not already on. */
async function ensureOverlayOn(
  page: Page,
  testId: "overlay-toggle-wind" | "overlay-toggle-tide" | "overlay-toggle-current",
): Promise<void> {
  const btn = page.locator(`[data-testid='${testId}']`).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  const pressed = await btn.getAttribute("aria-pressed").catch(() => null);
  if (pressed !== "true") {
    await btn.dispatchEvent("click");
  }
}

// ---------------------------------------------------------------------------
// Shared beforeEach
// ---------------------------------------------------------------------------

/**
 * ForecastStrip, TidePanel (embedded) and WeatherPanel all render inside the
 * Plan sidebar tab; the shared resetSettings fixture starts every test in
 * Explore mode, so the Plan tab must be opened before asserting them.
 */
async function openPlanTab(page: Page): Promise<void> {
  const planBtn = page.getByRole("button", { name: "Plan", exact: true });
  await expect(planBtn).toBeVisible({ timeout: 10_000 });
  await planBtn.dispatchEvent("click");
}

test.describe("LocationBadge on data panels", () => {
  test.beforeEach(async ({ page, request }) => {
    // Suppress the SimulatedDataConfirmDialog so it doesn't block interactions.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    // Ensure showTidePanel and autoLoadTidal are on so TidePanel can mount.
    await request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { showTidePanel: true, autoLoadTidal: true },
    });
    // Silence tidal schedule fetches (not relevant to badge tests).
    await page.route("**/api/tidal/schedule*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Panel 1: ForecastStrip
  // ─────────────────────────────────────────────────────────────────────────
  test.describe("ForecastStrip", () => {
    test("shows badge in ready state once surface-conditions data arrives", async ({ page }) => {
      test.setTimeout(90_000);
      // Ensure the Forecast sidebar section is expanded before the page
      // bootstraps. The panelCollapseStore persists to localStorage; a previous
      // test in the same browser context may have collapsed it.
      await page.addInitScript(() => {
        try {
          const raw = window.localStorage.getItem("bathyscan:panel-collapse");
          if (raw) {
            const stored = JSON.parse(raw) as {
              state?: { collapsed?: Record<string, boolean> };
            };
            if (stored?.state?.collapsed) {
              stored.state.collapsed["forecast"] = false;
              window.localStorage.setItem(
                "bathyscan:panel-collapse",
                JSON.stringify(stored),
              );
            }
          }
        } catch {}
      });
      await mockReadySurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown (auth bypass inactive)");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);

      const forecastSection = page.locator("[data-testid='sidebar-section-forecast']");
      await expect(forecastSection).toBeVisible({ timeout: 15_000 });

      // Expand the section if it was somehow still collapsed.
      const collapsedHeader = forecastSection.locator("button[aria-expanded='false']");
      if (await collapsedHeader.isVisible().catch(() => false)) {
        await collapsedHeader.dispatchEvent("click");
      }

      const badge = forecastSection.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 20_000 });
      await expect(badge).toHaveAttribute("data-state", "ready");

      const text = await badge.textContent();
      expect(text).toMatch(/\d+\.\d+°[NS]/);
      expect(text).toMatch(/\d+\.\d+°[EW]/);
    });

    test("shows badge in loading state while surface-conditions fetch is in-flight", async ({ page }) => {
      test.setTimeout(90_000);
      // Ensure the Forecast sidebar section is expanded before the page
      // bootstraps. The panelCollapseStore persists to localStorage; a previous
      // test in the same browser context may have collapsed it.
      await page.addInitScript(() => {
        try {
          const raw = window.localStorage.getItem("bathyscan:panel-collapse");
          if (raw) {
            const stored = JSON.parse(raw) as {
              state?: { collapsed?: Record<string, boolean> };
            };
            if (stored?.state?.collapsed) {
              stored.state.collapsed["forecast"] = false;
              window.localStorage.setItem(
                "bathyscan:panel-collapse",
                JSON.stringify(stored),
              );
            }
          }
        } catch {}
      });
      await mockStallingSurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);

      const forecastSection = page.locator("[data-testid='sidebar-section-forecast']");
      await expect(forecastSection).toBeVisible({ timeout: 15_000 });

      // Expand the section if it was somehow still collapsed.
      const collapsedHeader = forecastSection.locator("button[aria-expanded='false']");
      if (await collapsedHeader.isVisible().catch(() => false)) {
        await collapsedHeader.dispatchEvent("click");
      }

      // Once terrain is set the surface-conditions query fires but our stalling
      // route never resolves, so isLoading stays true → badge shows loading.
      const badge = forecastSection.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute("data-state", "loading");
      await expect(badge).toContainText("Updating…");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Panel 2: ConditionsLegend (Wind / Tide / Current)
  // ─────────────────────────────────────────────────────────────────────────
  test.describe("ConditionsLegend", () => {
    test.beforeEach(async ({ page }) => {
      // Reset overlay state so each test starts with all overlays OFF.
      // Since settingsStore v15, overlays are stored in the "bathyscan:settings"
      // JSON blob rather than individual localStorage keys.
      await page.addInitScript(() => {
        if (!sessionStorage.getItem("__condOverlayCleared")) {
          sessionStorage.setItem("__condOverlayCleared", "1");
          try {
            const raw = localStorage.getItem("bathyscan:settings");
            if (raw) {
              const parsed = JSON.parse(raw) as {
                state?: Record<string, unknown>;
              };
              if (parsed?.state) {
                parsed.state.windOverlayActive = false;
                parsed.state.tideOverlayActive = false;
                parsed.state.currentOverlayActive = false;
                localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
              }
            }
          } catch {}
          // Remove any legacy individual keys from older sessions.
          localStorage.removeItem("bathyscan:windOverlayActive");
          localStorage.removeItem("bathyscan:tideOverlayActive");
          localStorage.removeItem("bathyscan:currentOverlayActive");
        }
      });
    });

    test("shows badge in ready state once wind overlay is active and data arrives", async ({ page }) => {
      test.setTimeout(90_000);
      await mockReadySurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await ensureOverlayOn(page, "overlay-toggle-wind");

      const legend = page.locator("[data-testid='conditions-legend']");
      await expect(legend).toBeVisible({ timeout: 10_000 });

      const badge = legend.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 20_000 });
      await expect(badge).toHaveAttribute("data-state", "ready");

      const text = await badge.textContent();
      expect(text).toMatch(/\d+\.\d+°[NS]/);
      expect(text).toMatch(/\d+\.\d+°[EW]/);
    });

    test("shows badge in loading state while surface-conditions fetch is in-flight", async ({ page }) => {
      test.setTimeout(90_000);
      await mockStallingSurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await ensureOverlayOn(page, "overlay-toggle-wind");

      const legend = page.locator("[data-testid='conditions-legend']");
      await expect(legend).toBeVisible({ timeout: 10_000 });

      const badge = legend.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute("data-state", "loading");
      await expect(badge).toContainText("Updating…");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Panel 3: TidePanel (embedded inside the sidebar Conditions section)
  //
  // Loading state strategy: useTidalData preserves the previous `data` value
  // during a re-fetch while setting loading=true. By responding to the FIRST
  // tidal API call immediately (so TidePanel mounts) and stalling all
  // subsequent ones, clicking a "Tomorrow" day button changes scrubDatetime →
  // triggers a new fetch → TidePanel stays mounted with loading=true.
  // ─────────────────────────────────────────────────────────────────────────
  test.describe("TidePanel (embedded)", () => {
    test.beforeEach(async ({ page }) => {
      // Seed the OverlaysToolsPanel as expanded so tidal-overlay-toggle is
      // visible when the page loads.  panelCollapseStore persists under
      // "bathyscan:panel-collapse"; a previous test run may have left
      // overlaysTools=true (collapsed).
      await page.addInitScript(() => {
        try {
          const raw = window.localStorage.getItem("bathyscan:panel-collapse");
          const stored = raw
            ? (JSON.parse(raw) as { state?: { collapsed?: Record<string, boolean> } })
            : { state: { collapsed: {} } };
          if (!stored.state) stored.state = { collapsed: {} };
          if (!stored.state.collapsed) stored.state.collapsed = {};
          stored.state.collapsed["overlaysTools"] = false;
          window.localStorage.setItem("bathyscan:panel-collapse", JSON.stringify(stored));
        } catch {}
      });
    });

    test("shows badge in ready state once tidal overlay is active and data arrives", async ({ page }) => {
      test.setTimeout(90_000);
      await mockReadySurfaceConditions(page);
      await mockTidalDataReady(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);
      await ensureTidalOverlayOn(page);
      await ensurePlanTab(page);

      const tidePanel = page.locator("[data-testid='tide-panel']");
      await expect(tidePanel).toBeVisible({ timeout: 20_000 });

      const badge = tidePanel.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute("data-state", "ready");

      const text = await badge.textContent();
      expect(text).toMatch(/\d+\.\d+°[NS]/);
      expect(text).toMatch(/\d+\.\d+°[EW]/);
    });

    test("shows badge in loading state while a scrubDatetime re-fetch is in-flight", async ({ page }) => {
      test.setTimeout(90_000);
      await mockReadySurfaceConditions(page);
      const enableTidalStall = await mockTidalFirstFastThenStall(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);
      await ensureTidalOverlayOn(page);
      await ensurePlanTab(page);

      const tidePanel = page.locator("[data-testid='tide-panel']");
      await expect(tidePanel).toBeVisible({ timeout: 20_000 });

      // Wait for the initial tidal data to arrive (badge in ready state).
      const badge = tidePanel.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute("data-state", "ready");

      // Click "Tomorrow" (day offset 1) to change scrubDatetime. This triggers
      // a new useTidalData fetch with a datetime param. The second tidal call
      // stalls, but data from the first call is preserved — so TidePanel stays
      // mounted with loading=true, producing the loading badge.
      // Day buttons live inside the collapsible "Time scrub" Advanced section;
      // expand it first so the tomorrow button (offset 1) is interactable.
      const advToggle = page.locator("[data-testid='advanced-toggle-tidePanelTimeScrub']");
      if ((await advToggle.count()) > 0) {
        const expanded = await advToggle.getAttribute("aria-expanded").catch(() => null);
        if (expanded !== "true") {
          await advToggle.dispatchEvent("click");
        }
      }
      const tomorrowBtn = tidePanel.locator("[data-testid='tide-day-btn-1']");
      await expect(tomorrowBtn).toBeVisible({ timeout: 10_000 });
      enableTidalStall();
      await tomorrowBtn.dispatchEvent("click");

      await expect(badge).toHaveAttribute("data-state", "loading", { timeout: 10_000 });
      await expect(badge).toContainText("Updating…");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Panel 4: WeatherPanel (Drift Planner)
  // Badge is scoped to data-testid="weather-panel" to avoid matching badges
  // from other panels that are also visible (e.g. ForecastStrip).
  // ─────────────────────────────────────────────────────────────────────────
  test.describe("WeatherPanel (Drift Planner)", () => {
    test("shows badge in ready state once Drift Planner is open and data arrives", async ({ page }) => {
      test.setTimeout(90_000);
      await mockReadySurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);

      // Drift is now enabled via the Plan tab's "Start Planning" button
      // (the old top-right DRIFT toolbar toggle was removed).
      await ensurePlanTab(page);
      const startBtn = page.locator("[data-testid='start-planning-button']");
      await expect(startBtn).toBeVisible({ timeout: 10_000 });
      await startBtn.dispatchEvent("click");

      const weatherPanel = page.locator("[data-testid='weather-panel']");
      await expect(weatherPanel).toBeVisible({ timeout: 8_000 });

      const badge = weatherPanel.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 20_000 });
      await expect(badge).toHaveAttribute("data-state", "ready");

      const text = await badge.textContent();
      expect(text).toMatch(/\d+\.\d+°[NS]/);
      expect(text).toMatch(/\d+\.\d+°[EW]/);
    });

    test("shows badge in loading state while Drift Planner surface-conditions fetch is in-flight", async ({ page }) => {
      test.setTimeout(90_000);
      await mockStallingSurfaceConditions(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");

      if (!(await appIsSignedIn(page))) {
        test.skip(true, "Canvas not visible — landing page shown");
        return;
      }

      await ensureTerrainLoaded(page);
      await openPlanTab(page);

      // Drift is now enabled via the Plan tab's "Start Planning" button
      // (the old top-right DRIFT toolbar toggle was removed).
      await ensurePlanTab(page);
      const startBtn = page.locator("[data-testid='start-planning-button']");
      await expect(startBtn).toBeVisible({ timeout: 10_000 });
      await startBtn.dispatchEvent("click");

      const weatherPanel = page.locator("[data-testid='weather-panel']");
      await expect(weatherPanel).toBeVisible({ timeout: 8_000 });

      // Surface-conditions call stalls → isLoading stays true → loading badge.
      const badge = weatherPanel.locator("[data-testid='location-badge']");
      await expect(badge).toBeVisible({ timeout: 15_000 });
      await expect(badge).toHaveAttribute("data-state", "loading");
      await expect(badge).toContainText("Updating…");
    });
  });
});
