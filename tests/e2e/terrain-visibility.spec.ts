import {
  test,
  expect,
  apiUrl,
  DEFAULT_SETTINGS,
  E2E_USER_ID,
  type Page,
} from "./fixtures";

/**
 * Task #3007 — Catch invisible-terrain regressions in the real 3D viewport
 * before they ship.
 *
 * The historical bug: a land clamp of `Math.min(depth, 0)` in
 * buildTerrainGeometry (which assumed negative-down depths) collapsed EVERY
 * vertex of the all-positive Lake Ray Roberts grid to Y=0 — the whole mesh
 * flattened, the crosshair raycast always missed, and the HUD showed
 * "— NO TERRAIN —". Every unit test passed because none exercised the
 * dataset-load → geometry → crosshair pipeline end-to-end in the browser.
 *
 * This spec closes that gap:
 *   1. Loads the app via a real share link (`?ds=lake-ray-roberts`) with the
 *      dev auth bypass, letting the REAL dataset-load pipeline fetch the
 *      bundled Lake Ray Roberts terrain from the API server (no seeding, no
 *      route stubbing).
 *   2. Waits for `window.__bathyTest.getTerrainSummary()` to report the
 *      dataset with `hasTopography: true`.
 *   3. Calls `__bathyTest.probeTerrainGeometry()`, which builds the exact
 *      geometry TerrainMesh renders (buildTerrainGeometry — CPU-only, no
 *      WebGL needed) and publishes the deepest vertex to crosshairGps ONLY
 *      when the mesh has real vertical relief — the headless analog of a
 *      raycast hit. A flattened mesh ⇒ `flat: true`, no crosshair publish.
 *   4. Asserts the crosshair HUD shows a numeric depth, not "— NO TERRAIN —".
 *
 * Any regression in the depth→worldY mapping (geometry, sign convention,
 * clamping) that would blank the viewport fails this spec exactly the way a
 * user's crosshair would miss.
 */

// Share-link params inside the Lake Ray Roberts bbox
// (minLon -97.15, maxLon -96.92, minLat 33.3, maxLat 33.52 — see
// artifacts/api-server/src/lib/terrain.ts FRESHWATER_PRESET_DATASETS).
// All of lon/lat/depth/hdg must be present for decodeViewParams to accept
// the link and hand ?ds= to the dataset-load pipeline.
const SHARE_LINK =
  "/?lon=-97.035000&lat=33.410000&depth=10&hdg=0&ds=lake-ray-roberts";

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

test.describe("Terrain visibility — real dataset, real geometry", () => {
  test.beforeEach(async ({ page, request }) => {
    // Lake Ray Roberts is a FRESHWATER preset; the fixtures' resetSettings
    // seed sets waterType "saltwater", under which the preset list is empty
    // and the dataset-load pipeline has nothing to match ?ds= against.
    // Override server-side (source of truth after hydrate) and in the
    // persisted local store (so the first datasets query targets freshwater).
    await request.put(apiUrl("/api/settings"), {
      headers: { "x-e2e-user-id": E2E_USER_ID },
      data: { ...DEFAULT_SETTINGS, waterType: "freshwater" },
    });
    await page.addInitScript(() => {
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = { ...(parsed.state ?? {}), waterType: "freshwater" };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {}
    });
    // Suppress the SimulatedDataConfirmDialog so the dataset load completes
    // without a blocking modal.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
  });

  test("share link loads Lake Ray Roberts and the crosshair HUD reads a real depth", async ({
    page,
  }) => {
    await page.goto(SHARE_LINK);
    await page.waitForLoadState("domcontentloaded");
    await waitForTestApi(page);

    // 1. The REAL dataset-load pipeline (no seeding, no stubs) must deliver
    //    the bundled Lake Ray Roberts terrain with topography. Generous
    //    timeout: this is a genuine API fetch of the full bundle.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => window.__bathyTest!.getTerrainSummary()),
        { timeout: 30_000 },
      )
      .toEqual({ datasetId: "lake-ray-roberts", hasTopography: true });

    // 2. Build the real render geometry and publish the deepest vertex to
    //    the crosshair — the headless raycast analog. A flattened mesh
    //    (the invisible-terrain failure mode) reports flat:true and never
    //    publishes, leaving the HUD at "— NO TERRAIN —".
    const probe = await page.evaluate(() =>
      window.__bathyTest!.probeTerrainGeometry(),
    );
    expect(probe).not.toBeNull();
    expect(probe!.datasetId).toBe("lake-ray-roberts");
    // The mesh must have real vertical relief (Lake Ray Roberts spans
    // 0…~28 m). flat:true here is exactly the shipped invisible-terrain bug.
    expect(probe!.flat).toBe(false);
    expect(probe!.synced).toBe(true);
    expect(probe!.depthM).not.toBeNull();
    expect(probe!.depthM!).toBeGreaterThan(0);
    // Deepest vertex sits strictly below the waterline in world space.
    expect(probe!.minY).toBeLessThan(-0.001);

    // 3. The crosshair HUD must now display a numeric depth readout.
    const depthReadout = page.locator('[data-testid="hud-crosshair-depth"]');
    await expect(depthReadout).toBeVisible({ timeout: 10_000 });
    const text = (await depthReadout.textContent()) ?? "";
    expect(text).toMatch(/\d/);
    expect(text).not.toContain("NO TERRAIN");
    // Positive-down store depth renders with a leading minus (below water).
    expect(text.trim().startsWith("-")).toBe(true);

    // 4. And the failure placeholder must be absent from the HUD.
    await expect(page.locator("text=— NO TERRAIN —")).toHaveCount(0);
  });
});
