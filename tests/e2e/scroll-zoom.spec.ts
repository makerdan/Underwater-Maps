import { test, expect, type Page } from "./fixtures";

/**
 * Scroll-to-zoom end-to-end coverage.
 *
 * Verifies the full chain that the unit tests in zoomMath.test.ts can't reach:
 *
 *   1. Plain wheel → camera dollies along its view direction.
 *   2. Shift+wheel → speed-tier indicator advances (HUD store), camera does
 *      NOT dolly.
 *   3. Changing the Settings → Mouse Wheel Zoom Sensitivity slider visibly
 *      scales the next wheel-dolly distance.
 *
 * Strategy: the Three.js Canvas can't initialise WebGL in headless Playwright
 * (`Error creating WebGL context`), so `useFlyControls`'s real `gl.domElement`
 * wheel listener never attaches. Instead, the dev-only `__bathyTest` helpers
 * spin up a synthetic test camera and drive the SAME `processFlyWheel`
 * function the production hook calls, reading from the SAME Zustand stores
 * (`useSettingsStore`, `useCameraStore`). The Settings slider test still
 * navigates the real Settings UI to update the sensitivity store, so the
 * "slider → store → wheel handler" chain is exercised end-to-end.
 */

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

async function getCameraPos(page: Page): Promise<[number, number, number]> {
  return page.evaluate(() => window.__bathyTest!.getCameraPos());
}

async function initRig(page: Page): Promise<void> {
  // Camera at +Z, looking toward origin → forward dolly (negative deltaY)
  // should reduce z. lookAt isn't axis-aligned so x/y also shift slightly,
  // which the distance check tolerates.
  const ok = await page.evaluate(() =>
    window.__bathyTest!.initFlyWheelTestRig([0, 10, 50], [0, 0, 0]),
  );
  expect(ok).toBe(true);
}

function distance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * Audit note (Task #303): the `beforeEach` `goto("/")` below is required by
 * every test in this describe — they all drive `initRig()` which depends on
 * `__bathyTest.initFlyWheelTestRig()` and the underlying `TestCameraBridge`,
 * both of which are only mounted on the home route. The Settings-slider test
 * explicitly re-`goto("/")` + `initRig()` after editing /settings because
 * navigating away to /settings unmounts the camera bridge (see the inline
 * comment inside that test). No home-route warmups to retire here.
 */
test.describe("BathyScan — scroll-to-zoom controls", () => {
  test.beforeEach(async ({ page }) => {
    // Defensive stubs: prevent DatasetPanel / folder tree from crashing on
    // pre-existing malformed responses.
    const emptyJson = (route: import("@playwright/test").Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    await page.route("**/api/user/folders**", emptyJson);
    await page.route("**/api/datasets**", emptyJson);
    await page.route("**/api/user/datasets**", emptyJson);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
  });

  test("plain wheel dollies the camera along its view direction", async ({ page }) => {
    await initRig(page);

    // Default sensitivity so the dolly magnitude is meaningful.
    await page.evaluate(() => window.__bathyTest!.setMouseZoomSensitivity(1.0));

    const before = await getCameraPos(page);
    // Negative deltaY = scroll "up" = forward dolly toward what camera looks at.
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(-120, false),
    );
    const after = await getCameraPos(page);

    const moved = distance(before, after);
    expect(moved).toBeGreaterThan(0.5);
    // Camera was looking at origin from +Z, so forward dolly should reduce z.
    expect(after[2]).toBeLessThan(before[2]);
  });

  test("Shift+wheel advances the speed tier instead of dollying the camera", async ({ page }) => {
    await initRig(page);

    // Pin speed tier to a known mid-range value so we can detect a step up.
    await page.evaluate(() => window.__bathyTest!.setSpeedIndex(2));
    const beforeIdx = await page.evaluate(() =>
      window.__bathyTest!.getSpeedIndex(),
    );
    expect(beforeIdx).toBe(2);
    const beforePos = await getCameraPos(page);

    // Shift+scroll-down → speed tier up (matches HUD's SpeedDots indicator).
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(120, true),
    );
    const afterIdx = await page.evaluate(() =>
      window.__bathyTest!.getSpeedIndex(),
    );
    expect(afterIdx).toBe(beforeIdx + 1);

    // Shift+scroll-up → speed tier back down.
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(-120, true),
    );
    expect(
      await page.evaluate(() => window.__bathyTest!.getSpeedIndex()),
    ).toBe(beforeIdx);

    // And critically: the camera should NOT have dollied on shift-wheel.
    const afterPos = await getCameraPos(page);
    expect(distance(beforePos, afterPos)).toBeLessThan(1e-6);
  });

  test("Shift+wheel is a no-op when realistic (boat-MPH) mode is on", async ({ page }) => {
    await initRig(page);

    // Enable realistic mode through the TestBridge-backed AppContext setter.
    const enabled = await page.evaluate(() =>
      window.__bathyTest!.setRealisticMode(true),
    );
    expect(enabled).toBe(true);
    expect(
      await page.evaluate(() => window.__bathyTest!.getRealisticMode()),
    ).toBe(true);

    // Pin speed tier so we can detect a change (or lack thereof).
    await page.evaluate(() => window.__bathyTest!.setSpeedIndex(2));
    const beforeIdx = await page.evaluate(() =>
      window.__bathyTest!.getSpeedIndex(),
    );
    expect(beforeIdx).toBe(2);
    const beforePos = await getCameraPos(page);

    // Shift+wheel in realistic mode → processFlyWheel short-circuits, so
    // speed tier should NOT change and camera should NOT dolly (the boat-MPH
    // throttle owns speed in realistic mode).
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(120, true),
    );
    expect(
      await page.evaluate(() => window.__bathyTest!.getSpeedIndex()),
    ).toBe(beforeIdx);
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(-120, true),
    );
    expect(
      await page.evaluate(() => window.__bathyTest!.getSpeedIndex()),
    ).toBe(beforeIdx);

    const afterPos = await getCameraPos(page);
    expect(distance(beforePos, afterPos)).toBeLessThan(1e-6);

    // Reset for any subsequent tests sharing the page context.
    await page.evaluate(() => window.__bathyTest!.setRealisticMode(false));
  });

  test("Mouse Wheel Zoom Sensitivity slider scales the next wheel dolly", async ({ page }) => {
    await initRig(page);

    // ── Baseline dolly at sensitivity = 1.0× ──────────────────────────────
    await page.evaluate(() => window.__bathyTest!.setMouseZoomSensitivity(1.0));
    expect(
      await page.evaluate(() =>
        window.__bathyTest!.getMouseZoomSensitivity(),
      ),
    ).toBeCloseTo(1.0);

    const beforeA = await getCameraPos(page);
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(-120, false),
    );
    const afterA = await getCameraPos(page);
    const distA = distance(beforeA, afterA);
    expect(distA).toBeGreaterThan(0);

    // ── Drive sensitivity up via the Settings page UI so we exercise the
    //    Settings slider → settingsStore → wheel-handler chain end-to-end.
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await page.locator('button:has-text("CAMERA & CTRL")').first().click();

    // The Settings page renders rows as a div whose first child contains the
    // label text and whose second child contains the `<input type="range">`.
    const slider = page
      .locator('div:has(> div > div:text-is("Mouse Wheel Zoom Sensitivity"))')
      .locator('input[type="range"]')
      .first();
    await expect(slider).toBeVisible({ timeout: 5_000 });

    // Set the slider to its maximum (3.0) using the native input setter so
    // React's onChange fires and the settings store updates.
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.__bathyTest!.getMouseZoomSensitivity()),
      )
      .toBeGreaterThanOrEqual(2.5);

    // ── Return to the main page; re-init the rig (Settings nav unmounts the
    //    TestCameraBridge, so we need a fresh test camera at a known pose).
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    await initRig(page);

    const beforeB = await getCameraPos(page);
    await page.evaluate(() =>
      window.__bathyTest!.simulateFlyWheel(-120, false),
    );
    const afterB = await getCameraPos(page);
    const distB = distance(beforeB, afterB);

    // Higher sensitivity → strictly larger dolly for the same wheel delta.
    expect(distB).toBeGreaterThan(distA * 1.5);
  });
});
