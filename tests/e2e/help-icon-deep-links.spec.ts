import { test, expect, type Page } from "@playwright/test";

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
 * non-null. The shape is conservative — TidePanel reads `data.available` and
 * happily renders the header either way (showing a "No tidal station" body if
 * unavailable). For our purposes we just need the *header* to mount so the
 * help icon is in the DOM.
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
        available: false,
        station: null,
        distanceMeters: null,
        events: [],
        currentLevel: null,
        nextEvent: null,
        slack: null,
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
  });

  test("Throttle panel help icon → 'Throttle Panel' article", async ({ page }) => {
    test.setTimeout(60_000);
    await ensureSignedIn(page);

    // ThrottlePanel only mounts when "DRIVE BOAT" boat-throttle mode is on.
    const realisticBtn = page.locator("button", { hasText: /\bDRIVE BOAT\b/ }).first();
    await expect(realisticBtn).toBeVisible({ timeout: 10_000 });
    if (((await realisticBtn.textContent()) ?? "").trim().startsWith("○")) {
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
    await ensureSignedIn(page);

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
    await ensureSignedIn(page);

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
    await page.request.put("http://localhost:3151/api/settings", {
      headers: { "x-e2e-user-id": "dev-user-bypass" },
      data: { showTidePanel: true, autoLoadTidal: true },
    });
    await stubTidalEndpoints(page);
    await ensureSignedIn(page);

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
        { timeout: 20_000 },
      )
      .catch(() => {});
    // If terrain didn't load in time, seed synthetic terrain so useTidalData
    // receives non-null lat/lon coordinates and fires the tidal API fetch.
    const hasTerrain = await page.evaluate(
      () => Boolean((window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } }).__bathyTest?.getTerrainSummary?.()),
    ).catch(() => false);
    if (!hasTerrain) {
      await page.evaluate(
        () => (window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } }).__bathyTest?.seedTerrain?.(),
      );
      await page.waitForTimeout(500);
    }

    // Enable the tidal overlay via the top-right toolbar so <TidePanel /> mounts.
    const tidalBtn = page.locator("[data-testid='overlay-toggle-tide']");
    await expect(tidalBtn).toBeVisible({ timeout: 10_000 });
    // App auto-loads the overlay if `autoLoadTidal` is set; only click if off.
    const ariaPressed = await tidalBtn.getAttribute("aria-pressed").catch(() => null);
    if (ariaPressed !== "true") {
      await tidalBtn.dispatchEvent("click");
    }

    const icon = page.locator('[data-testid="help-icon-tidal-overlay"]');
    await expect(icon).toBeVisible({ timeout: 10_000 });
    await icon.dispatchEvent("click");

    await expectHelpOpenedTo(page, "Tidal Overlay");
    await closeHelpWindow(page);
  });
});
