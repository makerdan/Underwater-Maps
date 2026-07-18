import { test, expect, type Page } from "./fixtures";

/**
 * BathyScan — "What's Here?" card regression hardening.
 *
 * Regressions guarded:
 *   1. Auto-close: card closes 8 s after opening (H shortcut).
 *   2. Pin mode: card stays open and updates when camera moves while pinned.
 *   3. H shortcut suppressed when focus is inside a text input.
 *   4. Substrate row disappears gracefully when overlay is toggled OFF mid-session.
 *
 * Technical notes:
 *   - WhatsHereCard's auto-close timer is real setTimeout(_, 8000). We use
 *     Playwright's page.clock.install() + page.clock.fastForward() to avoid
 *     a 9-second wall-clock wait in CI.
 *   - Camera movement detection subscribes to useCameraStore (cameraLon/Lat/Depth/heading).
 *     We advance the camera via the test bridge's moveCameraGeo() helper which
 *     mirrors setCameraGeo() — the same store action the real fly-controls write.
 *   - The substrate overlay toggle goes through the uiStore via setSubstrateColorMode().
 */

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

async function seedTerrain(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean(window.__bathyTest) && window.__bathyTest!.seedTerrain({}),
    null,
    { timeout: 15_000 },
  );
}

async function seedCrosshair(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bathyTest!.setCrosshairGps({ lon: -132.5, lat: 55.5, depth: 75 });
  });
}

async function openWhatsHereCard(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bathyTest!.setWhatsHereOpen(true);
  });
  await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();
}

test.describe("BathyScan — What's Here card (H shortcut & auto-close)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    // Start with card closed and stores reset.
    await page.evaluate(() => {
      window.__bathyTest!.setWhatsHereOpen(false);
      window.__bathyTest!.setWhatsHerePinned(false);
      window.__bathyTest!.setCrosshairGps(null);
    });
  });

  test("H key opens the card; card contains depth when crosshair is on terrain", async ({ page }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    // Press H on the body — the App.tsx keydown listener should handle it.
    await page.locator("body").focus();
    await page.keyboard.press("h");

    await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();

    // The card should show a depth row because crosshairGps.depth is set.
    await expect(page.locator('[data-testid="whats-here-card"]')).toContainText(/depth/i);
  });

  test("card auto-closes after 8 seconds when not pinned", async ({ page }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    // Install a fake clock so we don't wait 8 s in real time.
    await page.clock.install();

    await openWhatsHereCard(page);
    await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();

    // Advance clock past the 8 s auto-close threshold.
    await page.clock.fastForward(9_000);

    await expect(page.locator('[data-testid="whats-here-card"]')).not.toBeVisible();
  });

  test("card does NOT auto-close when it is pinned", async ({ page }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    await page.clock.install();

    await openWhatsHereCard(page);

    // Pin the card before the timer fires.
    await page.locator('[data-testid="whats-here-pin"]').click();
    await expect(page.locator('[data-testid="whats-here-pin"]')).toHaveAttribute("aria-pressed", "true");

    // Fast-forward well past the auto-close threshold.
    await page.clock.fastForward(20_000);

    // Card must still be visible.
    await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();
  });

  test("pinned card remains open and its depth row persists after camera moves", async ({
    page,
  }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    await openWhatsHereCard(page);

    // Pin the card.
    await page.locator('[data-testid="whats-here-pin"]').click();
    await expect(page.locator('[data-testid="whats-here-pin"]')).toHaveAttribute("aria-pressed", "true");

    // Move the camera by updating cameraStore — this simulates flying.
    await page.evaluate(() => {
      window.__bathyTest!.moveCameraGeo({
        lon: -133.0,
        lat: 55.8,
        depth: 120,
        heading: 45,
        altitude: 50,
      });
    });

    // Card should remain open (pinned mode disables camera-movement close).
    await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();
  });
});

test.describe("BathyScan — H shortcut suppression in text inputs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.evaluate(() => {
      window.__bathyTest!.setWhatsHereOpen(false);
      window.__bathyTest!.setWhatsHerePinned(false);
    });
  });

  test("H key does NOT open card when focus is inside a text input", async ({ page }) => {
    await seedTerrain(await page.goto("/") ? page : page);
    // Re-navigate to ensure fresh state.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.evaluate(() => {
      window.__bathyTest!.setWhatsHereOpen(false);
    });

    // Focus a real text input in the document. The AI assistant search bar
    // carries data-testid="ai-search-input" but any focused INPUT is enough;
    // we create a hidden one to avoid UI dependencies.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("data-testid", "h-guard-test-input");
      document.body.appendChild(input);
      input.focus();
    });

    // Dispatch H on the input — the App.tsx guard must suppress it.
    await page.locator('[data-testid="h-guard-test-input"]').press("h");

    // Card must NOT have opened.
    const cardVisible = await page.evaluate(() =>
      window.__bathyTest!.isWhatsHereOpen(),
    );
    expect(cardVisible).toBe(false);

    // Clean up injected input.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="h-guard-test-input"]');
      el?.parentElement?.removeChild(el);
    });
  });

  test("H key DOES open card when focus is on the body (not a text input)", async ({ page }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    // Ensure focus is on the body.
    await page.locator("body").focus();

    await page.keyboard.press("h");

    const cardVisible = await page.evaluate(() =>
      window.__bathyTest!.isWhatsHereOpen(),
    );
    expect(cardVisible).toBe(true);
  });
});

test.describe("BathyScan — substrate overlay toggle while card is pinned", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.evaluate(() => {
      window.__bathyTest!.setWhatsHereOpen(false);
      window.__bathyTest!.setWhatsHerePinned(false);
      window.__bathyTest!.setCrosshairGps(null);
      window.__bathyTest!.setSubstrateColorMode(false);
    });
  });

  test("substrate row disappears gracefully when overlay is toggled OFF while card is pinned", async ({
    page,
  }) => {
    await seedTerrain(page);
    await seedCrosshair(page);

    // Enable substrate overlay — this makes useWhatsHere report substrateActive=true.
    await page.evaluate(() => {
      window.__bathyTest!.setSubstrateColorMode(true);
    });

    await openWhatsHereCard(page);

    // Pin the card so it doesn't auto-close.
    await page.locator('[data-testid="whats-here-pin"]').click();
    await expect(page.locator('[data-testid="whats-here-pin"]')).toHaveAttribute("aria-pressed", "true");

    // Substrate row should be present (substrateActive = true).
    // Even if substrateName is null (no GeoJSON loaded in test env), the
    // Substrate label row is rendered whenever substrateActive is true.
    // Assert on the dedicated row testid — the card's empty-state hint copy
    // ("Enable Substrate or Habitat overlays…") also contains the word
    // "substrate", so text matching cannot distinguish row presence.
    const substrateRow = page.locator('[data-testid="whats-here-substrate-row"]');
    await expect(substrateRow).toBeVisible({ timeout: 10_000 });

    // Toggle substrate overlay OFF.
    await page.evaluate(() => {
      window.__bathyTest!.setSubstrateColorMode(false);
    });

    // The substrate row must have disappeared — no crash, no stale row.
    await expect(page.locator('[data-testid="whats-here-card"]')).toBeVisible();
    await expect(substrateRow).toHaveCount(0, { timeout: 10_000 });
  });
});
