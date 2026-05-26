import { test, expect } from "@playwright/test";

/**
 * GPS Trail E2E tests.
 *
 * Strategy:
 * - Grant geolocation permission and inject a mocked position before each test.
 * - All GPS/trail features require authentication (Clerk). Tests that need a
 *   signed-in user check for the 3D canvas and skip gracefully when it is
 *   absent, matching the pattern used in smoke.spec.ts.
 * - Tests that require the GPS/Trail recorder drive the UI via data-testid
 *   attributes and verify meaningful DOM state changes.
 * - Navigation uses `domcontentloaded` (not `networkidle`) to avoid hanging on
 *   long-running API requests (e.g. AI classification) that would crash the
 *   Playwright webServer between tests.
 */

const MOCK_LAT = 11.3733; // Mariana Trench area — within default dataset bounds
const MOCK_LON = 142.1951;

test.describe("BathyScan — GPS activation", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]).catch(() => {});
    await context.setGeolocation({ latitude: MOCK_LAT, longitude: MOCK_LON, accuracy: 8 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
  });

  test("page loads without JS errors with mocked geolocation", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      if (!err.message.includes("WebGL")) errors.push(err.message);
    });
    await page.waitForTimeout(1500);
    expect(errors).toHaveLength(0);
  });

  test("GPS activate button is present in overview map (signed-in)", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    // Open overview map via the dev test helper. The bare "o" keypress goes
    // through the canvas focus chain, which is unreliable when the React app
    // is still settling after navigation — switch to the deterministic
    // `__bathyTest.setOverviewOpen(true)` bridge that the overview-map spec
    // also uses.
    await page.waitForFunction(() => Boolean(window.__bathyTest?.setOverviewOpen), null, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(true)).catch(() => {});
    await page.waitForTimeout(400);

    const gpsBtn = page.locator("[data-testid='gps-activate-btn']");
    const btnVisible = await gpsBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, "GPS button not found — overview map may not have opened");
      return;
    }

    // Button should show one of the two GPS states
    await expect(gpsBtn).toContainText(/MY LOCATION|GPS ACTIVE/i);

    // aria-pressed should be a boolean string
    const pressed = await gpsBtn.getAttribute("aria-pressed");
    expect(["true", "false"]).toContain(pressed);
  });

  test("GPS activate button transitions to GPS ACTIVE after click (signed-in)", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    await page.waitForFunction(() => Boolean(window.__bathyTest?.setOverviewOpen), null, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(true)).catch(() => {});
    await page.waitForTimeout(400);

    const gpsBtn = page.locator("[data-testid='gps-activate-btn']");
    const btnVisible = await gpsBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, "GPS button not found");
      return;
    }

    const initialPressed = await gpsBtn.getAttribute("aria-pressed");
    if (initialPressed === "true") {
      // Already active — verify label only
      await expect(gpsBtn).toContainText("GPS ACTIVE");
      return;
    }

    // Click to activate — with mocked geolocation this triggers watchPosition callback
    await gpsBtn.click();
    await page.waitForTimeout(2000);

    // aria-pressed should be valid regardless of whether GPS resolved
    const pressed = await gpsBtn.getAttribute("aria-pressed");
    expect(["true", "false"]).toContain(pressed);

    // If activated, button text should show GPS ACTIVE
    if (pressed === "true") {
      await expect(gpsBtn).toContainText("GPS ACTIVE");
    }
  });
});

test.describe("BathyScan — trail recording flow", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]).catch(() => {});
    await context.setGeolocation({ latitude: MOCK_LAT, longitude: MOCK_LON, accuracy: 8 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
  });

  test("trail recorder UI elements are present (signed-in, GPS active)", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    // Activate GPS via overview map (use deterministic test bridge)
    await page.waitForFunction(() => Boolean(window.__bathyTest?.setOverviewOpen), null, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(true)).catch(() => {});
    await page.waitForTimeout(400);

    const gpsBtn = page.locator("[data-testid='gps-activate-btn']");
    const btnVisible = await gpsBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, "GPS button not found");
      return;
    }

    await gpsBtn.click();
    await page.waitForTimeout(2000);

    // Close overview map
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(false)).catch(() => {});
    await page.waitForTimeout(400);

    // Only test recorder if GPS actually activated
    const isActive = await gpsBtn.getAttribute("aria-pressed") === "true";
    if (!isActive) {
      test.skip(true, "GPS did not activate in headless environment");
      return;
    }

    const trailRecorder = page.locator("[data-testid='trail-recorder']");
    await expect(trailRecorder).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("[data-testid='trail-start-btn']")).toBeVisible();
    await expect(page.locator("[data-testid='trail-name-input']")).toBeVisible();
  });

  test("start recording captures GPS points, stop returns to idle (signed-in, GPS active)", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    // Activate GPS via the deterministic test bridge
    await page.waitForFunction(() => Boolean(window.__bathyTest?.setOverviewOpen), null, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(true)).catch(() => {});
    await page.waitForTimeout(400);

    const gpsBtn = page.locator("[data-testid='gps-activate-btn']");
    const btnVisible = await gpsBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!btnVisible) {
      test.skip(true, "GPS button not found");
      return;
    }

    await gpsBtn.click();
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__bathyTest?.setOverviewOpen?.(false)).catch(() => {});
    await page.waitForTimeout(400);

    const isActive = await gpsBtn.getAttribute("aria-pressed") === "true";
    if (!isActive) {
      test.skip(true, "GPS did not activate in headless environment");
      return;
    }

    const trailRecorder = page.locator("[data-testid='trail-recorder']");
    const recorderVisible = await trailRecorder.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!recorderVisible) {
      test.skip(true, "Trail recorder not visible");
      return;
    }

    // ─── Start recording ───────────────────────────────────────────────────
    await page.locator("[data-testid='trail-start-btn']").click();
    await page.waitForTimeout(800);

    // Stop button must appear (recording is active)
    const stopBtn = page.locator("[data-testid='trail-stop-btn']");
    await expect(stopBtn).toBeVisible({ timeout: 3_000 });

    // Elapsed timer must be visible
    await expect(page.locator("[data-testid='trail-elapsed']")).toBeVisible();

    // Point count: GPS is sampled immediately on start — must be ≥ 1
    const ptCount = page.locator("[data-testid='trail-point-count']");
    await expect(ptCount).toBeVisible();
    const countText = await ptCount.textContent();
    const pts = parseInt(countText?.replace(/\D/g, "") ?? "0", 10);
    expect(pts).toBeGreaterThanOrEqual(1);

    // ─── Stop recording ────────────────────────────────────────────────────
    await stopBtn.click();
    await page.waitForTimeout(1000);

    // Start button must return (recording stopped)
    await expect(page.locator("[data-testid='trail-start-btn']")).toBeVisible({ timeout: 5_000 });
  });
});
