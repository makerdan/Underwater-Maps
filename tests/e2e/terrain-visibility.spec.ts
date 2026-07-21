import {
  test,
  expect,
  apiUrl,
  DEFAULT_SETTINGS,
  E2E_USER_ID,
  type Page,
} from "./fixtures";

/**
 * Task #3007 / #3039 — Catch invisible-terrain regressions in the real 3D
 * viewport before they ship — for EVERY bundled demo dataset, not just Lake
 * Ray Roberts.
 *
 * The historical bug: a land clamp of `Math.min(depth, 0)` in
 * buildTerrainGeometry (which assumed negative-down depths) collapsed EVERY
 * vertex of the all-positive Lake Ray Roberts grid to Y=0 — the whole mesh
 * flattened, the crosshair raycast always missed, and the HUD showed
 * "— NO TERRAIN —". Every unit test passed because none exercised the
 * dataset-load → geometry → crosshair pipeline end-to-end in the browser.
 *
 * This spec closes that gap, parameterized over bundled presets:
 *   0. Fetches GET /api/datasets (both water types) from the live API server
 *      and selects every preset whose fetchStrategy is "bundled" — the demo
 *      datasets whose terrain ships as a pre-built static bundle and is
 *      therefore loadable deterministically without external HTTP fetches.
 *      When a new bundled preset is added to FRESHWATER_PRESET_DATASETS /
 *      PRESET_DATASETS (e.g. a saltwater or Hawaii demo), it is picked up
 *      here automatically — no spec edit needed.
 *      (Bundled CATALOG entries such as Crater Lake / Lake Tahoe are not
 *      covered: they are not presets, so `?ds=` share links cannot reach
 *      them — they load via the catalog save/materialize pipeline instead.)
 *   For each bundled preset dataset:
 *   1. Loads the app via a real share link (`?ds=<id>` at the dataset's bbox
 *      center) with the dev auth bypass, letting the REAL dataset-load
 *      pipeline fetch the bundled terrain from the API server (no seeding,
 *      no route stubbing).
 *   2. Waits for `window.__bathyTest.getTerrainSummary()` to report the
 *      dataset with `hasTopography` matching the API's dataset metadata.
 *   3. Calls `__bathyTest.probeTerrainGeometry()`, which builds the exact
 *      geometry TerrainMesh renders (buildTerrainGeometry — CPU-only, no
 *      WebGL needed) and publishes the deepest vertex to crosshairGps ONLY
 *      when the mesh has real vertical relief — the headless analog of a
 *      raycast hit. A flattened mesh ⇒ `flat: true`, no crosshair publish.
 *   4. Asserts the crosshair HUD shows a numeric depth, not "— NO TERRAIN —".
 *
 * Any regression in the depth→worldY mapping (geometry, sign convention,
 * clamping) that would blank the viewport fails this spec exactly the way a
 * user's crosshair would miss — for every bundled demo lake.
 */

interface BundledDataset {
  id: string;
  name: string;
  waterType: "freshwater" | "saltwater";
  centerLon: number;
  centerLat: number;
  hasTopography?: boolean;
  fetchStrategy?: string;
}

/** Per-dataset budget for the real bundle fetch + geometry probe. */
const PER_DATASET_TIMEOUT_MS = 60_000;

async function waitForTestApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__bathyTest), null, {
    timeout: 15_000,
  });
}

test.describe("Terrain visibility — real bundled datasets, real geometry", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the SimulatedDataConfirmDialog so dataset loads complete
    // without a blocking modal.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
  });

  test("every bundled preset loads via share link and the crosshair HUD reads a real depth", async ({
    page,
    request,
  }) => {
    // ── 0. Discover the bundled presets from the live API ──────────────────
    // Query both water types: the preset list is filtered server-side, and a
    // future saltwater bundled demo must be covered too.
    const bundled: BundledDataset[] = [];
    for (const waterType of ["freshwater", "saltwater"] as const) {
      const res = await request.get(
        apiUrl(`/api/datasets?waterType=${waterType}`),
        { headers: { "x-e2e-user-id": E2E_USER_ID } },
      );
      expect(res.ok()).toBe(true);
      const list = (await res.json()) as BundledDataset[];
      bundled.push(...list.filter((d) => d.fetchStrategy === "bundled"));
    }

    // Drift guard: the flagship demo must always be present. If this fires,
    // either the preset was renamed/disabled or the fetchStrategy field
    // stopped being serialized — both would silently hollow out this spec.
    expect(
      bundled.map((d) => d.id),
      "GET /api/datasets must include at least the lake-ray-roberts bundled preset",
    ).toContain("lake-ray-roberts");

    test.setTimeout(30_000 + bundled.length * PER_DATASET_TIMEOUT_MS);

    for (const dataset of bundled) {
      await test.step(`bundled dataset ${dataset.id} (${dataset.name})`, async () => {
        // The fixtures' resetSettings seed sets waterType "saltwater"; the
        // dataset-load pipeline can only match ?ds= against presets of the
        // active water type. Override server-side (source of truth after
        // hydrate) and in the persisted local store (so the first datasets
        // query targets the right water type).
        await request.put(apiUrl("/api/settings"), {
          headers: { "x-e2e-user-id": E2E_USER_ID },
          data: { ...DEFAULT_SETTINGS, waterType: dataset.waterType },
        });
        // addInitScript registrations accumulate; the one registered last
        // runs last on each navigation, so later datasets override earlier
        // waterType writes. Values must be passed via the second arg —
        // factory closures lose captured variables silently.
        await page.addInitScript((wt: string) => {
          try {
            const raw = localStorage.getItem("bathyscan:settings");
            const parsed: { state?: Record<string, unknown>; version?: number } =
              raw ? JSON.parse(raw) : {};
            parsed.state = { ...(parsed.state ?? {}), waterType: wt };
            localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
          } catch {}
        }, dataset.waterType);

        // Share link at the dataset's bbox center. All of lon/lat/depth/hdg
        // must be present for decodeViewParams to accept the link and hand
        // ?ds= to the dataset-load pipeline.
        const shareLink =
          `/?lon=${dataset.centerLon.toFixed(6)}` +
          `&lat=${dataset.centerLat.toFixed(6)}` +
          `&depth=10&hdg=0&ds=${dataset.id}`;

        await page.goto(shareLink);
        await page.waitForLoadState("domcontentloaded");
        await waitForTestApi(page);

        // 1. The REAL dataset-load pipeline (no seeding, no stubs) must
        //    deliver the bundled terrain. Generous timeout: this is a
        //    genuine API fetch of the full bundle.
        await expect
          .poll(
            async () => {
              const summary = await page.evaluate(() =>
                window.__bathyTest!.getTerrainSummary(),
              );
              if (!summary) return summary;
              // Normalize: a missing hasTopography means "no topography" —
              // avoids a false mismatch (undefined vs false) if a future
              // bundled preset legitimately has no topography.
              return {
                datasetId: summary.datasetId,
                hasTopography: summary.hasTopography === true,
              };
            },
            { timeout: 30_000 },
          )
          .toEqual({
            datasetId: dataset.id,
            hasTopography: dataset.hasTopography === true,
          });

        // 2. Build the real render geometry and publish the deepest vertex
        //    to the crosshair — the headless raycast analog. A flattened
        //    mesh (the invisible-terrain failure mode) reports flat:true
        //    and never publishes, leaving the HUD at "— NO TERRAIN —".
        const probe = await page.evaluate(() =>
          window.__bathyTest!.probeTerrainGeometry(),
        );
        expect(probe, `${dataset.id}: probe returned null`).not.toBeNull();
        expect(probe!.datasetId).toBe(dataset.id);
        // The mesh must have real vertical relief. flat:true here is
        // exactly the shipped invisible-terrain bug.
        expect(probe!.flat, `${dataset.id}: mesh is flat`).toBe(false);
        expect(probe!.synced).toBe(true);
        expect(probe!.depthM).not.toBeNull();
        expect(probe!.depthM!).toBeGreaterThan(0);
        // Deepest vertex sits strictly below the waterline in world space.
        expect(probe!.minY).toBeLessThan(-0.001);

        // 3. The crosshair HUD must now display a numeric depth readout.
        const depthReadout = page.locator(
          '[data-testid="hud-crosshair-depth"]',
        );
        await expect(depthReadout).toBeVisible({ timeout: 10_000 });
        const text = (await depthReadout.textContent()) ?? "";
        expect(text).toMatch(/\d/);
        expect(text).not.toContain("NO TERRAIN");
        // Positive-down store depth renders with a leading minus (below
        // water).
        expect(text.trim().startsWith("-")).toBe(true);

        // 4. And the failure placeholder must be absent from the HUD.
        await expect(page.locator("text=— NO TERRAIN —")).toHaveCount(0);
      });
    }
  });
});
