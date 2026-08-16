import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Smoke spec — verifies the real App.tsx onBeforeSwitch wiring for the
 * water-type switch (unmount-before-load, see useWaterTypeSideEffects):
 *
 *   1. Loads the app via a real share link so the actual dataset-load
 *      pipeline mounts the bundled Lake Ray Roberts freshwater demo.
 *   2. Clicks the "Salt" segment of the WaterTypeToggle (with the
 *      simulated-data dialog suppressed so the switch confirms immediately).
 *   3. Asserts the React-bound terrain (via __bathyTest.getTerrainSummary())
 *      stops being lake-ray-roberts promptly — and never comes back — even
 *      though no saltwater replacement may finish loading.
 */

interface DatasetMetaLite {
  id: string;
  centerLon: number;
  centerLat: number;
}

const RAY_ID = "lake-ray-roberts";

test.describe("Ray Roberts unmount on Salt switch (smoke)", () => {
  test("clicking Salt immediately clears the Ray Roberts terrain", async ({ page }) => {
    test.setTimeout(120_000);

    // Boot in freshwater mode: patch both server-side settings and the
    // localStorage persist layer so hydration cannot race the water type
    // back to saltwater.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: { "x-e2e-user-id": E2E_USER_ID, "x-e2e-bypass-secret": "e2e-playwright-secret" },
      data: { waterType: "freshwater", colormapTheme: "freshwater" },
    });
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {
        /* noop */
      }
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = {
          ...(parsed.state ?? {}),
          waterType: "freshwater",
          colormapTheme: "freshwater",
        };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {
        /* noop */
      }
    });

    // Discover the Ray Roberts bbox center from the live API.
    const res = await page.request.get(`${API_URL}/api/datasets?waterType=freshwater`, {
      headers: { "x-e2e-user-id": E2E_USER_ID, "x-e2e-bypass-secret": "e2e-playwright-secret" },
    });
    expect(res.ok()).toBe(true);
    const datasets = (await res.json()) as DatasetMetaLite[];
    const ray = datasets.find((d) => d.id === RAY_ID);
    expect(ray, "lake-ray-roberts missing from freshwater catalog").toBeTruthy();

    // Share link at the dataset's bbox center — lon/lat/depth/hdg must all be
    // present for decodeViewParams to accept the link and hand ?ds= to the
    // dataset-load pipeline.
    const shareLink =
      `/?lon=${ray!.centerLon.toFixed(6)}&lat=${ray!.centerLat.toFixed(6)}` +
      `&depth=10&hdg=0&ds=${RAY_ID}`;
    await page.goto(shareLink);
    await page.waitForFunction(() => Boolean(window.__bathyTest), null, { timeout: 20_000 });

    // The real load pipeline delivers the bundled terrain.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => window.__bathyTest!.getTerrainSummary()?.datasetId ?? null),
        { timeout: 30_000 },
      )
      .toBe(RAY_ID);

    // Click the Salt segment. With the dialog suppressed, the confirmed
    // switch path runs the teardown before any new dataset id is set.
    const saltBtn = page.locator('[data-testid="water-type-saltwater"]');
    await expect(saltBtn).toBeVisible({ timeout: 20_000 });
    await saltBtn.dispatchEvent("click");

    // The Ray Roberts mesh source must vanish promptly (well before any
    // saltwater replacement could finish loading)...
    await expect
      .poll(
        async () =>
          await page.evaluate(() => window.__bathyTest!.getTerrainSummary()?.datasetId ?? null),
        { timeout: 5_000 },
      )
      .not.toBe(RAY_ID);

    // ...and must never come back.
    await page.waitForTimeout(2_000);
    const finalId = await page.evaluate(
      () => window.__bathyTest!.getTerrainSummary()?.datasetId ?? null,
    );
    expect(finalId).not.toBe(RAY_ID);
  });
});
