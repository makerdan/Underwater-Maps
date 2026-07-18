import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Help-icon deep-link coverage (task #219).
 *
 * Task #125 added inline <HelpIcon /> shortcuts to four spots in the UI:
 *
 *   - Tide panel header        → article "tidal-overlay"
 *   - Find Data drawer header  → article "find-data"
 *   - Throttle panel header    → article "throttle"
 *   - HUD overlay-toggle stack → article "hud-overlays"
 *
 * Each icon is supposed to open the Help window and jump straight to the
 * matching article. There is no automated coverage for that, so a rename of
 * an article id or a regression in `openHelp(articleId)` could silently
 * break the deep links.
 *
 * For each icon, this spec:
 *   1. Makes the panel visible (via real UI interactions or, for the tide
 *      panel, by mocking the tidal-data API so the panel renders
 *      deterministically without depending on NOAA reachability).
 *   2. Clicks `[data-testid="help-icon-<id>"]`.
 *   3. Asserts the Help window opens with a titlebar reading
 *      `◈ HELP — <expected article title>` and that the article title is
 *      also rendered inside the article body.
 */

async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto("/");
  // domcontentloaded (not networkidle): the home route keeps long-lived
  // requests open (NOAA, surface-conditions, terrain warm-up) so networkidle
  // never resolves before Playwright's 30 s timeout. The canvas visibility
  // check below is the real gate for "signed in".
  await page.waitForLoadState("domcontentloaded");
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — E2E auth bypass not active in this environment");
  }
}

async function expectHelpOpenedTo(page: Page, expectedTitle: string): Promise<void> {
  const win = page.locator('[data-testid="help-window"]');
  await expect(win).toBeVisible({ timeout: 5_000 });
  // Titlebar copy is "◈ HELP — <title>"
  await expect(win.locator("#help-window-title")).toHaveText(
    new RegExp(`HELP\\s*—\\s*${expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  // And the article body should render an <h1> with the same title.
  await expect(
    win.locator(".help-article h1", { hasText: new RegExp(`^${expectedTitle}$`) }),
  ).toBeVisible({ timeout: 5_000 });
}

async function closeHelpWindow(page: Page): Promise<void> {
  const closeBtn = page.locator('[data-testid="help-window"] .help-titlebar-close');
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.dispatchEvent("click");
    await expect(page.locator('[data-testid="help-window"]')).toHaveCount(0);
  }
}

/**
 * Stub the tidal-data endpoint(s) so the TidePanel renders without depending
 * on a real NOAA station being in range. The App only mounts <TidePanel /> if
 * `tidalData !== null`, so we need useTidalData() to resolve to something
 * non-null. We return `available: true` with a minimal valid payload so
 * TidePanel renders its full content (including the help icon in the header)
 * rather than a "No tidal station" fallback body.
 */
async function stubTidalEndpoints(page: Page): Promise<void> {
  // useTidalSchedule (more specific) calls /api/tidal/schedule — match it first.
  await page.route("**/api/tidal/schedule**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [] }),
    });
  });
  // useTidalData calls /api/tidal?lat=…&lon=…
  await page.route("**/api/tidal?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        stationName: "E2E Test Station",
        stationId: "9999999",
        source: "noaa",
        distanceMeters: 1000,
        tideHeight: 1.5,
        currentDirection: 90,
        currentSpeed: 0.5,
        isPredicted: true,
        nextEvent: null,
        slack: null,
        events: [],
      }),
    });
  });
}

test.describe("Help-icon deep links", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress SimulatedDataConfirmDialog before each test navigates so it
    // cannot block toolbar/toggle clicks or prevent TidePanel from mounting.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    // Skip the entire test early (before any test body runs) when the E2E
    // auth bypass is not active. Doing this in beforeEach rather than inside
    // each individual test body guarantees the skip fires before test-specific
    // setup (e.g. page.request.put calls) can throw a hard failure.
    await ensureSignedIn(page);
  });

  test("Throttle panel help icon → 'Throttle Panel' article", async ({ page }) => {
    test.setTimeout(60_000);

    // ThrottlePanel only mounts when Drive Boat (boat-throttle) mode is on.
    // The Drive Boat toggle moved from the old top-right toolbar to the top
    // of the Live sidebar tab.
    const liveTab = page.locator("[data-testid='sidebar-mode-tab-live']");
    await expect(liveTab).toBeVisible({ timeout: 10_000 });
    if ((await liveTab.getAttribute("aria-pressed").catch(() => null)) !== "true") {
      await liveTab.dispatchEvent("click");
      await expect(liveTab).toHaveAttribute("aria-pressed", "true");
    }
    const realisticBtn = page.locator("[data-testid='drive-boat-toggle']");
    await expect(realisticBtn).toBeVisible({ timeout: 10_000 });
    if ((await realisticBtn.getAttribute("aria-pressed").catch(() => null)) !== "true") {
      await realisticBtn.dispatchEvent("click");
    }

    const icon = page.locator('[data-testid="help-icon-throttle"]');
    await expect(icon).toBeVisible({ timeout: 10_000 });
    await icon.dispatchEvent("click");

    await expectHelpOpenedTo(page, "Throttle Panel");
    await closeHelpWindow(page);
  });

  test("HUD overlay-cluster help icon → 'HUD Overlay Toggles' article", async ({ page }) => {
    test.setTimeout(60_000);

    const icon = page.locator('[data-testid="help-icon-hud-overlays"]');
    await expect(icon).toBeVisible({ timeout: 10_000 });
    // The bottom-right Minimap canvas sits in the same corner and visually
    // overlaps part of this icon — Playwright's "real" click would land on
    // the canvas. Dispatch the click directly to the button element so we
    // exercise the React onClick handler regardless of z-order overlap.
    await icon.dispatchEvent("click");

    await expectHelpOpenedTo(page, "HUD Overlay Toggles");
    await closeHelpWindow(page);
  });

  test("Find Data drawer help icon → 'Find Data' article", async ({ page }) => {
    test.setTimeout(60_000);

    // Open the Find Data drawer via the HUD button. The Minimap canvas sits
    // in the same corner, so dispatch the click directly to the button.
    const findDataBtn = page.locator('button:has-text("FIND DATA")').first();
    await expect(findDataBtn).toBeVisible({ timeout: 10_000 });
    await findDataBtn.dispatchEvent("click");

    const icon = page.locator('[data-testid="help-icon-find-data"]');
    await expect(icon).toBeVisible({ timeout: 5_000 });
    await icon.dispatchEvent("click");

    await expectHelpOpenedTo(page, "Find Data");
    await closeHelpWindow(page);
  });

  test("Tide panel help icon → 'Tidal Overlay' article", async ({ page }) => {
    test.setTimeout(60_000);
    // Reset showTidePanel and autoLoadTidal so a prior test that disabled them
    // cannot prevent TidePanel from mounting in this test.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { showTidePanel: true, autoLoadTidal: true },
    });
    await stubTidalEndpoints(page);

    // useTidalData is gated on terrain coordinates being available.
    // Wait for any terrain (real auto-load or simulated fallback) to be
    // set in the store — once it is, useTidalData fires and the stubbed
    // tidal endpoint above responds, allowing TidePanel to mount.
    await page
      .waitForFunction(
        () =>
          Boolean(
            (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.(),
          ),
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => {});
    // If terrain didn't load in time, seed synthetic terrain so useTidalData
    // receives non-null lat/lon coordinates and fires the tidal API fetch.
    const hasTerrain = await page.evaluate(
      () => Boolean((window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.()),
    ).catch(() => false);
    if (!hasTerrain) {
      // Wait for the test bridge to be registered before calling seedTerrain —
      // after auth the React tree re-mounts and __bathyTest may not be wired
      // up yet. Without this guard, seedTerrain() is a silent no-op.
      await page
        .waitForFunction(
          () => typeof (window as unknown as { __bathyTest?: { seedTerrain?: unknown } }).__bathyTest?.seedTerrain === "function",
          undefined,
          { timeout: 10_000 },
        )
        .catch(() => {});
      await page.evaluate(
        () => (window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } }).__bathyTest?.seedTerrain?.(),
      );
      // Confirm the terrain actually propagated into the store before proceeding.
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

    // Enable the tidal overlay so <TidePanel /> mounts.
    // NOTE: The sidebar's [data-testid="overlay-toggle-tide"] controls the
    // surface-current-arrows overlay (useUiStore.tideOverlayActive) which is
    // independent from TidePanel mounting. TidePanel mounts when
    // `tidalOverlay` (context) is true — that state is toggled by the
    // 🌐 TIDAL 3D toggle [data-testid="tidal-overlay-toggle"], which now
    // lives in the Explore tab's Overlays panel (clicking it on also
    // auto-switches the sidebar to the Plan tab).
    const tidalBtn = page.locator("[data-testid='tidal-overlay-toggle']");
    await expect(tidalBtn).toBeVisible({ timeout: 10_000 });
    // `autoLoadTidal` may cause a useEffect to enable the overlay shortly
    // after mount. Wait for aria-pressed="true" to settle before reading so
    // we don't accidentally click the button off just as it auto-enables.
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector("[data-testid='tidal-overlay-toggle']");
          return btn?.getAttribute("aria-pressed") === "true";
        },
        undefined,
        { timeout: 5_000 },
      )
      .catch(() => {});
    // Only click if the overlay is still off after the effect had a chance to run.
    const ariaPressed = await tidalBtn.getAttribute("aria-pressed").catch(() => null);
    if (ariaPressed !== "true") {
      await tidalBtn.dispatchEvent("click");
    }

    // TidePanel lives in the Plan sidebar tab; the shared fixture resets
    // sidebarMode to "explore", so the Plan tab must be opened first.
    const planBtn = page.getByRole("button", { name: "Plan", exact: true });
    await expect(planBtn).toBeVisible({ timeout: 10_000 });
    await planBtn.dispatchEvent("click");

    const icon = page.locator('[data-testid="help-icon-tidal-overlay"]');
    await expect(icon).toBeVisible({ timeout: 10_000 });
    await icon.dispatchEvent("click");

    await expectHelpOpenedTo(page, "Tidal Overlay");
    await closeHelpWindow(page);
  });
});
