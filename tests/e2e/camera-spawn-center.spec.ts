import { test, expect, type Page } from "./fixtures";

/**
 * Camera spawn-center regression tests.
 *
 * Covers the `cameraSpawnBehaviour = "last"` branch in `resetCamera`
 * (useFlyControls.ts):
 *
 *   1. First load (no saved session) → camera placed at geographic centroid.
 *   2. Returning load (session exists for this dataset) → camera restores the
 *      saved position, NOT the centroid.
 *
 * Strategy: like scroll-zoom.spec.ts, these tests use the `__bathyTest` rig
 * because Three.js / WebGL can't initialise in headless Playwright. They:
 *   - Seed a synthetic terrain via `seedTerrain()`.
 *   - Set up settings-store state via `setCameraSpawnBehaviour()` /
 *     `setLastSession()`.
 *   - Call `resetCameraForSpawn()` to invoke the production `resetCamera`
 *     callback registered by `useFlyControls`.
 *   - Read the resulting world-space camera position back as lon/lat via
 *     `getCameraGeo()` (which uses the same `worldXZToLonLat` the production
 *     HUD reads) and assert proximity to the expected coordinates.
 *
 * The synthetic terrain has bounds minLon=-1, maxLon=1, minLat=-1, maxLat=1
 * so its geographic centroid is (lon=0, lat=0).
 */

const TERRAIN_CENTROID = { lon: 0, lat: 0 };

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

/**
 * Seed the default synthetic terrain (bounds −1→1 lon/lat, centroid at 0,0)
 * and wait for the `__bathyTest` API to confirm it is set.
 */
async function seedSyntheticTerrain(page: Page): Promise<void> {
  const ok = await page.evaluate(() => window.__bathyTest!.seedTerrain());
  expect(ok).toBe(true);
}

test.describe("BathyScan — camera spawn center on first dataset load", () => {
  test.beforeEach(async ({ page }) => {
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

  test("first load with no saved session places camera at geographic centroid", async ({
    page,
  }) => {
    // Set spawn behaviour to "last" and clear any saved session so this
    // simulates a genuine first load.
    await page.evaluate(() => {
      window.__bathyTest!.setCameraSpawnBehaviour("last");
      window.__bathyTest!.setLastSession(null);
    });

    // Seed the synthetic terrain (centroid lon=0, lat=0).
    await seedSyntheticTerrain(page);

    // The production `resetCamera` is registered by `useFlyControls` via the
    // TestBridge's `initFlyWheelTestRig`-style pattern. We need a live THREE
    // camera for `getCameraGeo` to read from, so initialise the fly-wheel rig
    // first (it creates a real PerspectiveCamera and registers it).
    const rigOk = await page.evaluate(() =>
      window.__bathyTest!.initFlyWheelTestRig([0, 10, 50], [0, 0, 0]),
    );
    expect(rigOk).toBe(true);

    // Trigger the production resetCamera callback.
    const spawnOk = await page.evaluate(() =>
      window.__bathyTest!.resetCameraForSpawn(),
    );
    expect(spawnOk).toBe(true);

    // Read back the camera position as lon/lat.
    const geo = await page.evaluate(() => window.__bathyTest!.getCameraGeo());
    expect(geo).not.toBeNull();

    // The camera should be at or very near the centroid of the synthetic
    // terrain (lon=0, lat=0). Allow ±0.05° tolerance (the synthetic grid is
    // only 2° wide so the world→geo mapping is coarse at this scale).
    expect(geo!.lon).toBeCloseTo(TERRAIN_CENTROID.lon, 1);
    expect(geo!.lat).toBeCloseTo(TERRAIN_CENTROID.lat, 1);
  });

  test("returning load with a saved session restores saved position, not centroid", async ({
    page,
  }) => {
    // Coordinates deliberately far from the centroid (0,0).
    const savedLon = 0.7;
    const savedLat = -0.6;

    // Wire up a saved session for the synthetic terrain's dataset ID
    // ("e2e-test" — matches the default `seedTerrain` datasetId).
    await page.evaluate(
      ({ lon, lat }) => {
        window.__bathyTest!.setCameraSpawnBehaviour("last");
        window.__bathyTest!.setLastSession({
          datasetId: "e2e-test",
          lon,
          lat,
          depth: 100,
          heading: 0,
        });
      },
      { lon: savedLon, lat: savedLat },
    );

    await seedSyntheticTerrain(page);

    const rigOk = await page.evaluate(() =>
      window.__bathyTest!.initFlyWheelTestRig([0, 10, 50], [0, 0, 0]),
    );
    expect(rigOk).toBe(true);

    const spawnOk = await page.evaluate(() =>
      window.__bathyTest!.resetCameraForSpawn(),
    );
    expect(spawnOk).toBe(true);

    const geo = await page.evaluate(() => window.__bathyTest!.getCameraGeo());
    expect(geo).not.toBeNull();

    // Camera must be near the saved position, NOT the centroid.
    expect(geo!.lon).toBeCloseTo(savedLon, 1);
    expect(geo!.lat).toBeCloseTo(savedLat, 1);

    // Sanity: confirm it is NOT at the centroid.
    const distFromCenter = Math.hypot(
      geo!.lon - TERRAIN_CENTROID.lon,
      geo!.lat - TERRAIN_CENTROID.lat,
    );
    expect(distFromCenter).toBeGreaterThan(0.3);
  });
});
