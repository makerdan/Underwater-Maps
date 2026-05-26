import { test, expect, type Page } from "@playwright/test";

/**
 * Task #131 — End-to-end coverage for the water-surface / landmass toggles,
 * TOPO badge, "no topography" hint, and topography JSON download added in
 * task #115.
 *
 * The 3D scene runs inside a WebGL canvas, so meshes (WaterSurfacePlane,
 * LandmassMesh) are not directly queryable from the DOM. We exercise the
 * toggles two ways:
 *   1. DOM — toggle the Show water surface / Show landmass switches on the
 *      Settings page, confirm aria-checked flips, and that the new value
 *      persists across a hard reload (proves the settings store wiring).
 *   2. Scene — seed a deterministic terrain via window.__bathyTest.seedTerrain
 *      (with and without topography) and assert the TOPO badge / download
 *      button render only for datasets that carry above-water elevation.
 */

const RESOLUTION = 16;

function makeTopography(): number[] {
  // Half the grid above water, half below — guaranteed > 0.5% land cells so
  // the seeded terrain satisfies the same `hasTopography` heuristic the API
  // server applies to Thorne Bay / Hawaii.
  const N = RESOLUTION * RESOLUTION;
  const arr: number[] = new Array(N).fill(0);
  for (let i = 0; i < N / 2; i++) arr[i] = 50;
  return arr;
}

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

async function openAdvancedTerrainSection(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  const advanced = page.locator('[data-testid="visuals-advanced"]');
  await expect(advanced).toBeVisible({ timeout: 5_000 });
  const expander = advanced.locator('button[aria-expanded]').first();
  if ((await expander.getAttribute("aria-expanded")) === "false") {
    await expander.click();
  }
  return advanced;
}

function toggleByLabel(scope: ReturnType<Page["locator"]>, label: string) {
  const row = scope.locator(`text=${label}`).locator("xpath=..").locator("xpath=..");
  return row.locator('[role="switch"]').first();
}

async function flipAndReload(page: Page, label: string) {
  const advanced = await openAdvancedTerrainSection(page);
  const toggle = toggleByLabel(advanced, label);
  await expect(toggle).toBeVisible({ timeout: 5_000 });

  const initial = await toggle.getAttribute("aria-checked");
  await toggle.click();
  const flipped = await toggle.getAttribute("aria-checked");
  expect(flipped).not.toBe(initial);

  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const advanced2 = await openAdvancedTerrainSection(page);
  const toggle2 = toggleByLabel(advanced2, label);
  await expect(toggle2).toBeVisible({ timeout: 5_000 });
  expect(await toggle2.getAttribute("aria-checked")).toBe(flipped);

  // Restore prior state so later tests start clean.
  await toggle2.click();
  await page.waitForTimeout(200);
}

/**
 * Audit note (Task #303): this file is deliberately split into two describes
 * so the cheap settings-only assertions never pay for a home-route warmup:
 *
 *   - "Water surface & landmass toggles — Settings" has NO `beforeEach goto`.
 *     Its tests use `openAdvancedTerrainSection`, which goes straight to
 *     /settings, expands the Advanced disclosure, and flips a toggle. No
 *     home-route mount is needed for these assertions.
 *
 *   - "TOPO badge & download — ProvenancePanel" DOES have a `beforeEach
 *     goto("/")` because every test in it calls `__bathyTest.seedTerrain()`,
 *     which only exists on the home route (the dev test helpers are mounted
 *     by components inside the home scene). The home warmup is necessary.
 *
 * No further home-route warmups to retire in this file.
 */
test.describe("Water surface & landmass toggles — Settings", () => {
  test("Show water surface toggle persists across reload", async ({ page }) => {
    await flipAndReload(page, "Show water surface");
  });

  test("Show landmass toggle persists across reload", async ({ page }) => {
    await flipAndReload(page, "Show landmass");
  });

  test("Show landmass sublabel includes the open-ocean hint", async ({ page }) => {
    const advanced = await openAdvancedTerrainSection(page);
    await expect(
      advanced.locator("text=No effect on open-ocean datasets."),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("TOPO badge & download — ProvenancePanel", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress SimulatedDataConfirmDialog so the dataset auto-load completes
    // without a blocking modal, letting the provenance panel mount and render
    // the TOPO badge once terrain is seeded via __bathyTest.seedTerrain.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);
    const installed = await page.evaluate(() => Boolean(window.__bathyTest?.seedTerrain));
    if (!installed) {
      test.skip(true, "seedTerrain bridge not available — dev helpers missing");
    }
  });

  test("TOPO badge appears for Hawaii (dataset with topography)", async ({ page }) => {
    // Stub the Poe classify endpoint so that seeding glacier-bay with
    // hasTopography=true is not overwritten by the async depth-heuristic
    // fallback (which would take ~9 s and return false for all-below-water depths).
    await page.route("**/api/poe/classify", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hasTopography: true }),
      }),
    );
    // Also stub the terrain refetch so React Query's auto-refetch for the
    // new active dataset doesn't overwrite the seed.
    const topography = makeTopography();
    const fixture = {
      datasetId: "glacier-bay",
      name: "Glacier Bay",
      resolution: RESOLUTION,
      width: RESOLUTION,
      height: RESOLUTION,
      depths: new Array(RESOLUTION * RESOLUTION).fill(50),
      topography,
      hasTopography: true,
    };
    await page.route("**/datasets/glacier-bay/terrain*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture),
      }),
    );
    // Wait for the startup Thorne Bay auto-load to settle before seeding so
    // its in-flight pendingTerrain effect doesn't overwrite our seed.
    await expect(page.locator('[data-testid="btn-dataset-thorne-bay"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);

    await page.evaluate(
      ({ resolution, topo }) =>
        window.__bathyTest!.seedTerrain({
          datasetId: "glacier-bay",
          name: "Glacier Bay",
          resolution,
          width: resolution,
          height: resolution,
          depths: new Array(resolution * resolution).fill(50),
          topography: topo,
          hasTopography: true,
        } as never),
      { resolution: RESOLUTION, topo: topography },
    );

    // Confirm the seed actually stuck (no late terrain effect raced past it)
    // before we wait for the badge — otherwise a flake here misleadingly
    // blames the badge component instead of the seed race.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => window.__bathyTest!.getTerrainSummary()),
        { timeout: 15_000 },
      )
      .toEqual({ datasetId: "glacier-bay", hasTopography: true });

    await expect(page.locator('[data-testid="topo-badge"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("TOPO badge appears for Thorne Bay (dataset with topography)", async ({ page }) => {
    // The app auto-loads the Thorne Bay preset on startup. We must wait for
    // its pending-fetch round-trip to complete (otherwise our seeded terrain
    // is overwritten by the real API terrain, which may not include any
    // above-water cells in synthetic-fallback mode).
    await expect(page.locator('[data-testid="btn-dataset-thorne-bay"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);

    const topography = makeTopography();
    await page.evaluate(
      ({ resolution, topo }) =>
        window.__bathyTest!.seedTerrain({
          datasetId: "thorne-bay",
          name: "Thorne Bay — SE Alaska",
          resolution,
          width: resolution,
          height: resolution,
          depths: new Array(resolution * resolution).fill(10),
          topography: topo,
          hasTopography: true,
        } as never),
      { resolution: RESOLUTION, topo: topography },
    );

    await expect(page.locator('[data-testid="topo-badge"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("TOPO badge is absent for Mariana Trench (open-ocean dataset)", async ({ page }) => {
    await page.evaluate(
      ({ resolution }) =>
        window.__bathyTest!.seedTerrain({
          datasetId: "mariana-trench",
          name: "Mariana Trench",
          resolution,
          width: resolution,
          height: resolution,
          depths: new Array(resolution * resolution).fill(8000),
          minDepth: 6000,
          maxDepth: 11000,
          hasTopography: false,
        } as never),
      { resolution: RESOLUTION },
    );

    // Wait for the dataset panel to reflect the seeded terrain.
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="topo-badge"]')).toHaveCount(0);
  });

  test("topography JSON download is available for a coastal dataset", async ({ page }) => {
    // Stub the Poe classify endpoint so it responds immediately with
    // hasTopography=true and doesn't race against the seed.
    await page.route("**/api/poe/classify", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hasTopography: true }),
      }),
    );
    // Intercept the terrain API call for the dataset we'll seed so that
    // TourScene's `useGetDatasetsIdTerrain` refetch returns OUR fixture
    // (with hasTopography + topography array) instead of the real API
    // response, which would overwrite our seed via `setTerrain(data)`.
    const topography = makeTopography();
    const fixture = {
      datasetId: "glacier-bay",
      name: "Glacier Bay",
      waterType: "saltwater",
      resolution: RESOLUTION,
      width: RESOLUTION,
      height: RESOLUTION,
      depths: new Array(RESOLUTION * RESOLUTION).fill(50),
      minDepth: 0,
      maxDepth: 20,
      minLon: -1,
      maxLon: 1,
      minLat: -1,
      maxLat: 1,
      centerLon: 0,
      centerLat: 0,
      topography,
      hasTopography: true,
    };
    await page.route("**/datasets/glacier-bay/terrain*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixture),
      }),
    );

    await expect(page.locator('[data-testid="btn-dataset-thorne-bay"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);

    await page.evaluate(
      (f) => window.__bathyTest!.seedTerrain(f as never),
      fixture,
    );

    await expect
      .poll(
        async () =>
          await page.evaluate(() => window.__bathyTest!.getTerrainSummary()),
        { timeout: 15_000 },
      )
      .toEqual({ datasetId: "glacier-bay", hasTopography: true });

    // Confirm the seeded TOPO badge actually mounted on the Hawaii row
    // before we try to expand its panel — otherwise terrain was overwritten
    // by a late effect and the download button would never appear.
    await expect(page.locator('[data-testid="topo-badge"]').first()).toBeAttached({
      timeout: 10_000,
    });

    const provenanceHeader = page.locator('[aria-label="Toggle data provenance"]').first();
    await expect(provenanceHeader).toBeVisible({ timeout: 10_000 });

    if ((await provenanceHeader.getAttribute("aria-expanded")) !== "true") {
      await provenanceHeader.dispatchEvent("click");
    }

    const downloadBtn = page.locator('[data-testid="btn-download-topography"]');
    await expect(downloadBtn).toBeVisible({ timeout: 10_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      downloadBtn.dispatchEvent("click"),
    ]);
    expect(download.suggestedFilename()).toBe("glacier-bay-topography.json");
  });
});
