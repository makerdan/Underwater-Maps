import { test, expect, type Page } from "./fixtures";

/**
 * Crosshair action menu e2e (Task #394).
 *
 * Task #384 added a Q-key shortcut and a touch "⋯ ACTIONS" button on the
 * HUD that pop the terrain context menu anchored at the underwater
 * crosshair. The shared helper `openCrosshairContextMenu` is unit-tested
 * in isolation; this spec exercises the real wiring end-to-end:
 *
 *   1. With a loaded dataset and the crosshair "on terrain", the menu
 *      opens over the reticle with all five expected items.
 *   2. With no crosshair target (off-terrain), the shortcut is a no-op.
 *   3. Each menu item produces the same observable side effect as the
 *      equivalent right-click flow (drop pin, measure, set home,
 *      start depth profile, copy coords).
 *   4. On a touch-emulated browser, tapping the HUD's "⋯ ACTIONS" button
 *      opens the same menu AND its items wire to the same side effects.
 *   5. When the headless Chromium GPU process supports WebGL the real
 *      <Canvas>-mounted keydown listener inside `useFlyControls`
 *      handles Q directly. That integration is covered by a dedicated
 *      test that skips itself when the canvas never mounts (the current
 *      state on the Replit-managed runner — see playwright.config.ts
 *      NOTE and tests/e2e/webgl-smoke.spec.ts). The deterministic
 *      action-parity tests below call `pressCrosshairShortcut`, which
 *      mirrors the real handler line-for-line, so the menu-open path is
 *      always exercised even when WebGL is unavailable.
 *
 * The crosshair raycaster lives inside the Three.js render loop and
 * can't be driven reliably in headless Chromium, so we seed the
 * cameraStore `crosshairGps` slot directly via
 * `window.__bathyTest.setCrosshairGps` (the same store the real
 * raycaster writes to). The Q key handler in `useFlyControls`, the
 * HUD's touch button, and our `pressCrosshairShortcut` test helper all
 * pull from this slot via the same `openCrosshairContextMenu` helper.
 */

const CROSSHAIR_POINT = { lon: -132.45, lat: 56.0, depth: 137 } as const;
const SEEDED_DATASET_ID = "e2e-test";

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

async function seedTerrainAndCrosshair(page: Page): Promise<void> {
  // seedTerrain() requires the <TestBridge/> inside <AppProvider/> to
  // have mounted, which happens once the bypassed-auth React tree
  // renders.
  await page.waitForFunction(
    () => Boolean(window.__bathyTest) && window.__bathyTest!.seedTerrain({}),
    null,
    { timeout: 15_000 },
  );
  await page.evaluate((point) => {
    window.__bathyTest!.setCrosshairGps(point);
  }, CROSSHAIR_POINT);
}

async function resetCrosshairState(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bathyTest!.hideContextMenu();
    window.__bathyTest!.setCrosshairGps(null);
    window.__bathyTest!.clearMeasurement();
    window.__bathyTest!.clearDepthProfile();
    window.__bathyTest!.setMarkerFormOpen(false);
    window.__bathyTest!.clearLastClickedGps();
  });
}

/**
 * Install a clipboard write spy *before* the app boots so the production
 * `copyToClipboard` helper inside `terrainContextMenu.ts` records every
 * write into `window.__clipboardWrites`. Using a spy rather than
 * `navigator.clipboard.readText()` avoids cross-origin / permission
 * issues in headless Chromium.
 */
async function installClipboardSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites =
      [];
    const ok = (text: string) => {
      (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites
        .push(text);
      return Promise.resolve();
    };
    // Some browsers ship `clipboard` as a getter-only property, so we
    // replace it wholesale with a writable shim.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: ok, readText: () => Promise.resolve("") },
    });
  });
}

async function openCrosshairMenu(page: Page): Promise<void> {
  // Always go through the test helper that mirrors the production Q
  // handler. This keeps the action-parity assertions deterministic on
  // hosts where the real <Canvas>-mounted listener never attached.
  const opened = await page.evaluate(() =>
    window.__bathyTest!.pressCrosshairShortcut(),
  );
  expect(opened).toBe(true);
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

test.describe("BathyScan — Crosshair action menu (desktop / Q key)", () => {
  test.beforeEach(async ({ page }) => {
    await installClipboardSpy(page);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await resetCrosshairState(page);
  });

  test("Q opens the crosshair menu over the reticle with all nine items", async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    const menu = page.locator('[data-testid="context-menu"]');

    // Nine action items: Drop pin / Log a catch / Measure / Set home /
    // Save bookmark / Start straight-line profile / Start path profile /
    // Copy coords / Copy share link. The separator above "Copy coordinates"
    // renders as a non-menuitem <li role="separator">.
    const items = menu.locator('[role="menuitem"]');
    await expect(items).toHaveCount(9);
    await expect(items.nth(0)).toContainText("Drop GPS pin here");
    await expect(items.nth(1)).toContainText("Log a catch here");
    await expect(items.nth(2)).toContainText("Measure from here");
    await expect(items.nth(3)).toContainText("Set as home position");
    // Label source: terrainContextMenu.ts buildTerrainMenuItems — keep in sync
    await expect(items.nth(4)).toContainText("Save as saved view…");
    await expect(items.nth(5)).toContainText("Start straight-line profile");
    await expect(items.nth(6)).toContainText("Start path profile");
    await expect(items.nth(7)).toContainText("Copy coordinates");
    await expect(items.nth(8)).toContainText("Copy share link");
    await expect(menu.locator('[role="separator"]')).toHaveCount(1);

    // Menu should be anchored at (roughly) the viewport centre — that's
    // where the crosshair reticle sits. Allow ±25% slop because the
    // menu's position is clamped to stay on-screen.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThan(viewport.width * 0.25);
      expect(box.x).toBeLessThan(viewport.width * 0.75);
      expect(box.y).toBeGreaterThan(viewport.height * 0.25);
      expect(box.y).toBeLessThan(viewport.height * 0.75);
    }
  });

  test("Q is a no-op when the crosshair is off terrain", async ({ page }) => {
    // Seed terrain so a dataset is loaded, but leave crosshairGps null —
    // simulates the camera looking at the sky / water surface where the
    // raycaster misses the seafloor mesh.
    await page.waitForFunction(
      () => Boolean(window.__bathyTest) && window.__bathyTest!.seedTerrain({}),
      null,
      { timeout: 15_000 },
    );
    await page.evaluate(() => window.__bathyTest!.setCrosshairGps(null));

    // Both the real Q keydown AND the test-only mirror of the production
    // handler must bail because `crosshairGps` is null (early return in
    // `openCrosshairContextMenu`).
    await page.locator("body").focus();
    await page.keyboard.press("KeyQ");
    const openedFromShortcut = await page.evaluate(() =>
      window.__bathyTest!.pressCrosshairShortcut(),
    );
    expect(openedFromShortcut).toBe(false);

    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toHaveCount(0);

    const snapshot = await page.evaluate(() =>
      window.__bathyTest!.getContextMenuSnapshot(),
    );
    expect(snapshot.open).toBe(false);
    expect(snapshot.labels).toEqual([]);
  });

  test('"Drop GPS pin here" opens the marker form pre-filled with the crosshair coords', async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Drop GPS pin here" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

    const markerFormOpen = await page.evaluate(() =>
      window.__bathyTest!.isMarkerFormOpen(),
    );
    expect(markerFormOpen).toBe(true);

    const lastClicked = await page.evaluate(() =>
      window.__bathyTest!.getLastClickedGps(),
    );
    expect(lastClicked).toEqual(CROSSHAIR_POINT);
  });

  test('"Measure from here" sets the measurement anchor at the crosshair', async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Measure from here" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

    const anchor = await page.evaluate(() =>
      window.__bathyTest!.getMeasurementAnchor(),
    );
    expect(anchor).toEqual(CROSSHAIR_POINT);

    // Anchor-set banner is the same UI surface the right-click measure
    // flow puts up; existence proves the crosshair path wired through.
    await expect(
      page.locator('[data-testid="measurement-banner"]'),
    ).toContainText(/ANCHOR SET/i);

    // Re-opening the menu should now show "Measure to here" — the same
    // anchor-aware label flip the right-click flow gets in
    // tests/e2e/context-menu.spec.ts.
    await openCrosshairMenu(page);
    await expect(
      page.locator('[data-testid="context-menu"] [role="menuitem"]').nth(2),
    ).toContainText("Measure to here");
  });

  test('"Set as home position" persists the crosshair coords for the active dataset', async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Set as home position" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

    const saved = await page.evaluate(
      (id) => window.__bathyTest!.getDatasetHome(id),
      SEEDED_DATASET_ID,
    );
    expect(saved).toEqual(CROSSHAIR_POINT);
  });

  test('"Start straight-line profile" places the profile anchor at the crosshair', async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Start straight-line profile" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

    const anchor = await page.evaluate(() =>
      window.__bathyTest!.getDepthProfileAnchor(),
    );
    expect(anchor).toEqual(CROSSHAIR_POINT);

    // Re-opening the menu should now show "End depth profile here" and
    // a "Cancel depth profile" entry — proves the same anchor-aware
    // branch the right-click flow takes.
    await openCrosshairMenu(page);
    const itemsAfter = page.locator(
      '[data-testid="context-menu"] [role="menuitem"]',
    );
    await expect(itemsAfter.nth(5)).toContainText("End depth profile here");
    await expect(itemsAfter).toContainText(["Cancel depth profile"]);
  });

  test('"Copy coordinates" writes the formatted crosshair coords to the clipboard', async ({
    page,
  }) => {
    await seedTerrainAndCrosshair(page);
    await openCrosshairMenu(page);

    await page
      .locator('[data-testid="context-menu"] [role="menuitem"]')
      .filter({ hasText: "Copy coordinates" })
      .click();

    await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

    const writes = await page.evaluate(
      () =>
        (window as unknown as { __clipboardWrites: string[] })
          .__clipboardWrites,
    );
    // Format mirrors `formatCoords` in terrainContextMenu.ts:
    //   "lat: <lat>, lon: <lon>, depth: <rounded>m"
    expect(writes).toEqual([
      `lat: ${CROSSHAIR_POINT.lat.toFixed(5)}, lon: ${CROSSHAIR_POINT.lon.toFixed(
        5,
      )}, depth: ${Math.round(CROSSHAIR_POINT.depth)}m`,
    ]);
  });
});

test.describe(
  "BathyScan — Crosshair Q key (production listener integration)",
  () => {
    // This describe specifically asserts that the real <Canvas>-mounted
    // keydown listener inside `useFlyControls` handles Q without the
    // test-only `pressCrosshairShortcut` fallback. The Canvas only
    // mounts on hosts where headless Chromium can initialise WebGL —
    // when it can't (the current state on the Replit-managed runner,
    // see tests/e2e/webgl-smoke.spec.ts), this test is skipped at
    // runtime so a regression in the keydown wiring cannot silently
    // pass under the deterministic helper-based tests above.
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      await waitForTestApi(page);
      await resetCrosshairState(page);
    });

    test("dispatching a real Q keystroke opens the menu when the Canvas is mounted", async ({
      page,
    }) => {
      // Skip when the headless Chromium GPU process can't initialise a
      // WebGL context — the Three.js <Canvas> bails out before
      // useFlyControls mounts its keydown listener, so the real Q
      // shortcut path is genuinely unverifiable in that environment.
      // The deterministic action-parity tests above already cover the
      // helper that the keydown handler delegates to. The probe matches
      // the one in tests/e2e/webgl-smoke.spec.ts.
      const hasWebgl = await page.evaluate(() => {
        const c = document.createElement("canvas");
        return Boolean(
          c.getContext("webgl2") ?? c.getContext("webgl"),
        );
      });
      test.skip(
        !hasWebgl,
        "WebGL unavailable on this runner — the Three.js <Canvas> and its " +
          "useFlyControls keydown listener never mount. The helper-based " +
          "tests above exercise the same `openCrosshairContextMenu` path.",
      );

      await seedTerrainAndCrosshair(page);

      await page.locator("body").focus();
      await page.keyboard.press("KeyQ");

      await expect(
        page.locator('[data-testid="context-menu"]'),
      ).toBeVisible();
      const snapshot = await page.evaluate(() =>
        window.__bathyTest!.getContextMenuSnapshot(),
      );
      expect(snapshot.open).toBe(true);
      expect(snapshot.labels).toContain("Drop GPS pin here");
      expect(snapshot.labels).toContain("Copy coordinates");
    });
  },
);

// Re-run the open + a representative action-parity check under a
// touch-emulated browser context so the HUD picks the "⋯ ACTIONS"
// branch of its IS_TOUCH_DEVICE module check. That branch is computed
// once at module evaluation, so the touch flag must be active *before*
// the page navigates.
test.describe(
  "BathyScan — Crosshair action menu (touch / ⋯ ACTIONS button)",
  () => {
    test.use({ hasTouch: true, isMobile: true });

    test.beforeEach(async ({ page }) => {
      await installClipboardSpy(page);
      await page.goto("/");
      await page.waitForLoadState("domcontentloaded");
      await waitForTestApi(page);
      await resetCrosshairState(page);
    });

    test("tapping the HUD ⋯ ACTIONS button opens the crosshair menu with all nine items", async ({
      page,
    }) => {
      await seedTerrainAndCrosshair(page);

      // The button only renders when crosshairGps is non-null — wait
      // for the HUD to react to the seeded store update.
      const actionsBtn = page.locator('[data-testid="hud-crosshair-actions"]');
      await expect(actionsBtn).toBeVisible();

      await actionsBtn.dispatchEvent("click");

      const menu = page.locator('[data-testid="context-menu"]');
      await expect(menu).toBeVisible();

      const items = menu.locator('[role="menuitem"]');
      await expect(items).toHaveCount(9);
      await expect(items.nth(0)).toContainText("Drop GPS pin here");
      await expect(items.nth(1)).toContainText("Log a catch here");
      await expect(items.nth(2)).toContainText("Measure from here");
      await expect(items.nth(3)).toContainText("Set as home position");
      // Label source: terrainContextMenu.ts buildTerrainMenuItems — keep in sync
      await expect(items.nth(4)).toContainText("Save as saved view…");
      await expect(items.nth(5)).toContainText("Start straight-line profile");
      await expect(items.nth(6)).toContainText("Start path profile");
      await expect(items.nth(7)).toContainText("Copy coordinates");
      await expect(items.nth(8)).toContainText("Copy share link");
    });

    test('touch flow: "Drop GPS pin here" opens the marker form pre-filled', async ({
      page,
    }) => {
      await seedTerrainAndCrosshair(page);

      await page.locator('[data-testid="hud-crosshair-actions"]').dispatchEvent("click");
      await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();

      await page
        .locator('[data-testid="context-menu"] [role="menuitem"]')
        .filter({ hasText: "Drop GPS pin here" })
        .dispatchEvent("click");

      await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

      const markerFormOpen = await page.evaluate(() =>
        window.__bathyTest!.isMarkerFormOpen(),
      );
      expect(markerFormOpen).toBe(true);

      const lastClicked = await page.evaluate(() =>
        window.__bathyTest!.getLastClickedGps(),
      );
      expect(lastClicked).toEqual(CROSSHAIR_POINT);
    });

    test('touch flow: "Copy coordinates" writes the formatted coords to the clipboard', async ({
      page,
    }) => {
      await seedTerrainAndCrosshair(page);

      await page.locator('[data-testid="hud-crosshair-actions"]').dispatchEvent("click");
      await page
        .locator('[data-testid="context-menu"] [role="menuitem"]')
        .filter({ hasText: "Copy coordinates" })
        .dispatchEvent("click");

      await expect(page.locator('[data-testid="context-menu"]')).toHaveCount(0);

      const writes = await page.evaluate(
        () =>
          (window as unknown as { __clipboardWrites: string[] })
            .__clipboardWrites,
      );
      expect(writes).toEqual([
        `lat: ${CROSSHAIR_POINT.lat.toFixed(5)}, lon: ${CROSSHAIR_POINT.lon.toFixed(
          5,
        )}, depth: ${Math.round(CROSSHAIR_POINT.depth)}m`,
      ]);
    });
  },
);
