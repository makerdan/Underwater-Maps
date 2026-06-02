import { test, expect, type Page, type Locator } from "./fixtures";

/**
 * Drift Planner — Drift vs Trolling mode coverage.
 *
 * Covers:
 *   - Switching to Trolling, adjusting heading + speed, and asserting the
 *     timeline + HUD reflect the new mode and values.
 *   - Switching back to Drift restores the original readouts.
 *   - Edge case: 0 kt boat speed in trolling produces the same drift-speed
 *     readout as pure drift mode (i.e. boat contribution is zero).
 *   - Edge case: speed clamps to TROLL_MAX_KNOTS (10 kt) even when a larger
 *     value is typed in.
 *
 * Skips gracefully when the 3D canvas isn't visible (auth landing page),
 * matching the convention used in drift-planner.spec.ts.
 */

const TROLL_MAX_KNOTS = 10;

async function appIsSignedIn(page: Page): Promise<boolean> {
  return await page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
}

async function openDriftPlanner(page: Page): Promise<void> {
  // Activate via TestBridge: the production UI opens the planner by clicking
  // a forecast slot (<div role="button">, no text "DRIFT"), which requires
  // surface-conditions data and sidebar scroll. Driving the store directly
  // exercises WeatherPanel + DriftTimeline without sidebar dependencies.
  await page.evaluate(() =>
    (
      window as unknown as {
        __bathyTest?: { setDriftPlannerActive?: (v: boolean) => void };
      }
    ).__bathyTest?.setDriftPlannerActive?.(true),
  );
  await expect(page.locator("text=DRIFT PLANNER")).toBeVisible({ timeout: 5_000 });
  // Timeline only renders after computeDrift resolves (needs surface conditions).
  await expect(page.locator("[data-testid='timeline-drift-mode-badge']")).toBeVisible({
    timeout: 15_000,
  });
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

async function setRange(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function switchMode(page: Page, mode: "drift" | "trolling"): Promise<void> {
  // Use the data-testid added to the WeatherPanel mode toggle buttons so the
  // selector is unambiguous — avoids strict-mode violations from other "DRIFT"
  // or "TROLLING" text nodes in the DOM (drift-trolling-modes.spec.ts:149).
  const btn = page.locator(`[data-testid="drift-mode-btn-${mode}"]`);
  await btn.dispatchEvent("click");
}

test.describe("Drift Planner — Drift vs Trolling modes", () => {
  test.beforeEach(async ({ page }) => {
    // Extend timeout to 60 s — terrain wait + seedTerrain + WeatherPanel can
    // exceed the 30 s default, especially on a cold browser context.
    test.setTimeout(60_000);
    // Suppress SimulatedDataConfirmDialog and register the surface-conditions
    // mock BEFORE goto so React Query's initial fetch is intercepted.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await mockOkSurfaceConditions(page);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // useSurfaceConditions is gated on centerLat !== null (needs terrain).
    // Wait up to 10 s for real terrain, then fall back to seedTerrain so
    // the surface-conditions mock above is guaranteed to fire.
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

  test("Trolling: heading + speed propagate to HUD and Timeline; switching back restores Drift", async ({
    page,
  }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    await openDriftPlanner(page);

    const hudBadge = page.locator("[data-testid='hud-drift-mode-badge']");
    const timelineBadge = page.locator("[data-testid='timeline-drift-mode-badge']");

    // ── Baseline: Drift mode ────────────────────────────────────────────
    await expect(hudBadge).toContainText("DRIFT");
    await expect(hudBadge).not.toContainText("TROLL");
    await expect(timelineBadge).toContainText("DRIFT");
    await expect(timelineBadge).not.toContainText("TROLLING");

    // ── Switch to Trolling ──────────────────────────────────────────────
    await switchMode(page, "trolling");

    // Trolling controls are now visible.
    const headingSlider = page.locator("[data-testid='boat-heading-slider']");
    const speedInput = page.locator("[data-testid='boat-speed-input']");
    await expect(headingSlider).toBeVisible();
    await expect(speedInput).toBeVisible();

    // Set heading = 90°, speed = 3.5 kt.
    await setRange(headingSlider, 90);
    await speedInput.fill("3.5");
    await speedInput.blur();

    // Timeline + HUD badges reflect Trolling, heading and speed.
    await expect(timelineBadge).toContainText("TROLLING");
    await expect(timelineBadge).toContainText("90°");
    await expect(timelineBadge).toContainText("3.5 KT");

    await expect(hudBadge).toContainText("TROLL");
    await expect(hudBadge).toContainText("090°");
    await expect(hudBadge).toContainText("3.5 KT");

    // ── Switch back to Drift restores the original readouts ─────────────
    await switchMode(page, "drift");

    await expect(hudBadge).toContainText("DRIFT");
    await expect(hudBadge).not.toContainText("TROLL");
    await expect(timelineBadge).toContainText("DRIFT");
    await expect(timelineBadge).not.toContainText("TROLLING");
    // Trolling controls disappear when the panel is back in Drift mode.
    await expect(headingSlider).toHaveCount(0);
    await expect(speedInput).toHaveCount(0);
  });

  test("Edge case: 0 kt boat speed in Trolling matches the Drift-mode readout", async ({
    page,
  }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    await openDriftPlanner(page);

    const driftSpeed = page.locator("[data-testid='drift-speed-value']");
    await expect(driftSpeed).toBeVisible({ timeout: 15_000 });

    // Capture the drift-speed reading at hour 0 in pure Drift mode.
    const driftReading = (await driftSpeed.textContent())?.trim();
    expect(driftReading).toBeTruthy();

    // Switch to Trolling and set boat speed to 0 (any heading).
    await switchMode(page, "trolling");
    const headingSlider = page.locator("[data-testid='boat-heading-slider']");
    const speedInput = page.locator("[data-testid='boat-speed-input']");
    await setRange(headingSlider, 180);
    await speedInput.fill("0");
    await speedInput.blur();

    // Mode badges confirm trolling at 0 kt.
    await expect(page.locator("[data-testid='hud-drift-mode-badge']")).toContainText(
      "0.0 KT",
    );

    // The selected-hour drift-speed value should match the pure-drift reading
    // (boat contribution is zero, so wind+tidal physics are identical).
    await expect(driftSpeed).toHaveText(driftReading!);
  });

  test("Edge case: boat speed clamps at TROLL_MAX_KNOTS (10 kt)", async ({ page }) => {
    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — landing page shown");
      return;
    }

    await openDriftPlanner(page);
    await switchMode(page, "trolling");

    const speedInput = page.locator("[data-testid='boat-speed-input']");
    await expect(speedInput).toBeVisible();

    // Try to type a value far above the max — the store clamps it.
    await speedInput.fill("25");
    await speedInput.blur();

    // The bound value should clamp to 10.
    await expect(speedInput).toHaveValue(String(TROLL_MAX_KNOTS));

    // HUD + timeline reflect the clamped value, not 25.
    const hudBadge = page.locator("[data-testid='hud-drift-mode-badge']");
    const timelineBadge = page.locator("[data-testid='timeline-drift-mode-badge']");
    await expect(hudBadge).toContainText("10.0 KT");
    await expect(timelineBadge).toContainText("10.0 KT");
    await expect(hudBadge).not.toContainText("25");
    await expect(timelineBadge).not.toContainText("25");
  });
});
