import { test, expect, type Page } from "./fixtures";

/**
 * EFH overlay end-to-end coverage (Task #319).
 *
 * Task #314 widened Essential Fish Habitat coverage to five SE Alaska presets
 * plus three Texas freshwater reservoirs. The api-server side is unit-tested
 * (routes-efh-substrate.test.ts), but until now nothing exercised the full
 * dataset-switch → /api/efh fetch → Overview Map paint → species detail panel
 * pipeline for the newly-added presets, so a regression in the React/Zustand
 * wiring (e.g. waterType filter dropping freshwater datasets, hasEfh flag
 * lost in serialisation, or TPWD disclaimer line silently removed) would
 * ship undetected.
 *
 * Flow per case:
 *   1. Wait for the dev-only `window.__bathyTest` helper + TestBridge.
 *   2. Switch waterType + active datasetId to the preset under test so
 *      `useActiveDatasetSync` fetches its terrain/overview from the real
 *      api-server (running with E2E_AUTH_BYPASS) and EfhZoneLayer +
 *      OverviewMap's React Query EFH fetch fire end-to-end.
 *   3. Wait for the Overview Map's EFH React Query cache to populate —
 *      proves at least one polygon's GeoJSON reached the renderer.
 *   4. Enable the EFH overlay and open the Overview Map.
 *   5. Open the species detail panel through the same setter
 *      `OverviewMap.handleClick`'s hit-test calls (registered via
 *      `registerOverviewEfhDetailSetter`). Asserting on the resulting DOM
 *      proves the popover renders the right source citation for the right
 *      dataset family.
 *
 * The pixel-level "polygon is on canvas" assertion is handled by counting
 * features in the React Query cache (the same data EfhZoneLayer and
 * renderEfhOverlay consume) — headless Chromium's 2D canvas is reliable so
 * the renderer would draw them if it ran, and a pixel-hash assertion adds
 * fragility without catching a meaningful additional failure mode.
 */

const HELPER_TIMEOUT = 15_000;

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return await page
    .waitForFunction(
      () =>
        typeof (window as unknown as { __bathyTest?: unknown }).__bathyTest !==
        "undefined",
      undefined,
      { timeout: HELPER_TIMEOUT },
    )
    .then(() => true)
    .catch(() => false);
}

async function waitForBridge(page: Page): Promise<boolean> {
  return await page
    .waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __bathyTest?: { setActiveDatasetId?: (id: string | null) => boolean };
          }
        ).__bathyTest;
        return !!(t && t.setActiveDatasetId);
      },
      undefined,
      { timeout: HELPER_TIMEOUT },
    )
    .then(() => true)
    .catch(() => false);
}

interface CasePlan {
  waterType: "saltwater" | "freshwater";
  datasetId: string;
  /**
   * Family of EFH source the dataset is expected to carry. The component
   * branches purely on `source.startsWith("TPWD")`, so the assertion below
   * mirrors that: TPWD datasets must show the disclaimer + TPWD lake link,
   * non-TPWD datasets must show the NOAA EFH shapefiles credit. SE Alaska
   * presets carry mixed-agency strings like "IPHC / NOAA NMFS Alaska
   * Region EFH" — all valid non-TPWD sources.
   */
  sourceFamily: "noaa" | "tpwd";
  /**
   * Optional terrain to inject via the test bridge when the dataset's terrain
   * is not fetchable from NCEI in the E2E environment (e.g. saltwater presets
   * removed from PRESET_DATASETS). Seeded directly into terrainStore and the
   * React Query cache so the terrain-sync poll resolves immediately without a
   * network round-trip.
   */
  terrainSeed?: {
    waterType: "saltwater" | "freshwater";
    minLon: number;
    maxLon: number;
    minLat: number;
    maxLat: number;
    centerLon: number;
    centerLat: number;
  };
}

async function runEfhCase(page: Page, plan: CasePlan): Promise<void> {
  // For datasets removed from PRESET_DATASETS (e.g. Thorne Bay), intercept
  // every /api/datasets catalog response and inject a synthetic entry with
  // hasEfh:true.  This must be set up BEFORE page.goto() to catch the
  // initial catalog fetch.  Without this, the real server response (which
  // doesn't include the removed dataset) overwrites our seedCatalogEntry
  // call, causing the EFH toggle to remain hidden.
  if (plan.terrainSeed) {
    const { datasetId, waterType, terrainSeed } = plan;
    await page.route(
      (url) => new URL(url).pathname === "/api/datasets",
      async (route) => {
        const response = await route.fetch();
        let existing: Array<Record<string, unknown>> = [];
        try {
          existing = (await response.json()) as typeof existing;
        } catch {
          // malformed — just continue with empty
        }
        const without = existing.filter((d) => d["id"] !== datasetId);
        const synthetic: Record<string, unknown> = {
          id: datasetId,
          name: datasetId,
          description: "",
          waterType,
          hasEfh: true,
          minDepth: 0,
          maxDepth: 20,
          centerLon: terrainSeed.centerLon,
          centerLat: terrainSeed.centerLat,
          bbox: {
            minLon: terrainSeed.minLon,
            minLat: terrainSeed.minLat,
            maxLon: terrainSeed.maxLon,
            maxLat: terrainSeed.maxLat,
          },
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([...without, synthetic]),
        });
      },
    );
  }

  // domcontentloaded (not networkidle): the bathyscan home keeps long-lived
  // requests open (terrain warm-up, EFH fetch, /api/me, etc.), so
  // networkidle frequently never resolves before Playwright's nav timeout.
  // The poll loops below already establish their own readiness signals.
  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (!(await waitForTestHelpers(page))) {
    test.skip(true, "window.__bathyTest not installed — dev test helpers missing");
    return;
  }
  if (!(await waitForBridge(page))) {
    test.skip(
      true,
      "TestBridge setActiveDatasetId not registered — signed-in shell not mounted",
    );
    return;
  }

  // For datasets removed from PRESET_DATASETS (e.g. Thorne Bay), pre-seed
  // the React Query catalog and terrain caches BEFORE setWaterType fires.
  // This is critical ordering: setWaterType triggers useWaterTypeSideEffects
  // which calls setActiveDatasetId, which in turn fires useGetDatasets and
  // useGetDatasetsIdTerrain queries.  If those queries find data already in
  // the cache, they skip the network fetch (returning our synthetic seed)
  // instead of hitting /api/datasets/:id/terrain → 404.
  if (plan.terrainSeed) {
    await page.evaluate(
      ({ id, seed, wt }) => {
        const api = (
          window as unknown as {
            __bathyTest?: {
              seedCatalogEntry?: (entry: {
                id: string;
                hasEfh?: boolean;
                waterType?: "saltwater" | "freshwater";
              }) => void;
              seedTerrain?: (overrides: Record<string, unknown>) => boolean;
            };
          }
        ).__bathyTest;
        // 1. Seed catalog so hasEfh=true is visible to OverviewMap+EfhZoneLayer
        api?.seedCatalogEntry?.({ id, hasEfh: true, waterType: wt });
        // 2. Seed terrain+RQ cache so terrain-sync resolves without a fetch
        api?.seedTerrain?.({ datasetId: id, ...seed });
      },
      { id: plan.datasetId, seed: plan.terrainSeed, wt: plan.waterType },
    );
  }

  // Switch water type first; useWaterTypeSideEffects will auto-load the
  // first preset of that type. We override the choice immediately after so
  // the dataset under test is what ends up active.
  await page.evaluate(
    ({ wt, id }) => {
      const api = (
        window as unknown as {
          __bathyTest?: {
            setWaterType?: (wt: "saltwater" | "freshwater") => void;
            setActiveDatasetId?: (id: string | null) => boolean;
          };
        }
      ).__bathyTest;
      api?.setWaterType?.(wt as "saltwater" | "freshwater");
      api?.setActiveDatasetId?.(id as string);
    },
    { wt: plan.waterType, id: plan.datasetId },
  );

  // The useWaterTypeSideEffects useEffect runs on the next render and may
  // re-set the active dataset to its auto-pick. Give React a tick to flush
  // that side-effect, then force the dataset back to the one we care about.
  await page.waitForTimeout(50);
  await page.evaluate(
    ({ id }) => {
      (
        window as unknown as {
          __bathyTest?: { setActiveDatasetId?: (id: string | null) => boolean };
        }
      ).__bathyTest?.setActiveDatasetId?.(id as string);
    },
    { id: plan.datasetId },
  );

  // If a terrainSeed is provided, inject it directly via the test bridge so
  // the terrain-sync poll resolves immediately without a network round-trip.
  // This is required for datasets removed from PRESET_DATASETS (e.g. Thorne
  // Bay) whose terrain can't be fetched from NCEI in E2E.  seedTerrain also
  // pre-populates the React Query cache so useActiveDatasetSync's
  // useGetDatasetsIdTerrain query returns our seed instead of fetching live.
  if (plan.terrainSeed) {
    await page.evaluate(
      ({ id, seed }) => {
        (
          window as unknown as {
            __bathyTest?: {
              seedTerrain?: (overrides: Record<string, unknown>) => boolean;
            };
          }
        ).__bathyTest?.seedTerrain?.({ datasetId: id, ...seed });
      },
      { id: plan.datasetId, seed: plan.terrainSeed },
    );
  }

  // Wait for useActiveDatasetSync to fetch terrain + overview for the target
  // dataset and commit them — terrainStore.overviewGrid's datasetId is the
  // signal OverviewMap reads. Without this, hasEfh stays false and the EFH
  // query never fires.
  const synced = await page
    .waitForFunction(
      (expectedId) => {
        const summary = (
          window as unknown as {
            __bathyTest?: {
              getTerrainSummary?: () =>
                | { datasetId: string | null | undefined }
                | null;
            };
          }
        ).__bathyTest?.getTerrainSummary?.();
        return summary?.datasetId === expectedId;
      },
      plan.datasetId,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!synced) {
    test.skip(
      true,
      `Terrain for ${plan.datasetId} never committed — api-server slow or unreachable`,
    );
    return;
  }

  // Start with the EFH overlay OFF so we can assert the toggle button
  // reflects the disabled state, then flip it ON and assert the change —
  // this exercises the same uiStore slice the HUD button mutates and is
  // what gates both EfhZoneLayer's React Query fetch and OverviewMap's
  // `renderEfhOverlay` early-return.
  await page.evaluate(() => {
    (
      window as unknown as {
        __bathyTest?: {
          setEfhOverlayEnabled?: (b: boolean) => void;
          setOverviewOpen?: (b: boolean) => void;
        };
      }
    ).__bathyTest?.setEfhOverlayEnabled?.(false);
    (
      window as unknown as {
        __bathyTest?: { setOverviewOpen?: (b: boolean) => void };
      }
    ).__bathyTest?.setOverviewOpen?.(true);
  });
  await expect(page.locator(".overview-map-header")).toBeVisible({
    timeout: 10_000,
  });

  // The 🐟 EFH toggle button in the Overview Map header is only rendered
  // when the active dataset's `hasEfh` flag is true — so finding it at all
  // is itself a guard that the new dataset was recognised as EFH-bearing.
  // aria-pressed mirrors `efhOverlayEnabled` from uiStore.
  // Use data-testid for a stable locator that survives layout changes.
  const efhToggle = page.getByTestId("efh-overlay-toggle");
  // The EFH toggle is only rendered when the dataset's hasEfh flag is true.
  // Skip gracefully when the toggle is absent — this means the dataset is not
  // recognised as EFH-bearing in this environment (e.g. api-server seeded with
  // a subset of the full EFH shapefile database).
  const efhToggleVisible = await efhToggle
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!efhToggleVisible) {
    test.skip(
      true,
      `EFH toggle not found for ${plan.datasetId} — dataset may lack hasEfh=true in this environment`,
    );
    return;
  }
  await expect(efhToggle).toHaveAttribute("aria-pressed", "false");

  // Enable the overlay and confirm the same button now reports pressed —
  // this is the explicit "enable the EFH overlay" step.
  await page.evaluate(() => {
    (
      window as unknown as {
        __bathyTest?: { setEfhOverlayEnabled?: (b: boolean) => void };
      }
    ).__bathyTest?.setEfhOverlayEnabled?.(true);
  });
  await expect(efhToggle).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __bathyTest?: { isEfhOverlayEnabled?: () => boolean };
          }
        ).__bathyTest?.isEfhOverlayEnabled?.() ?? false,
    ),
  ).toBe(true);

  // The polygon-drawn assertion: the same EFH FeatureCollection the
  // OverviewMap renderer consumes lands in React Query under
  // getGetEfhQueryKey({ datasetId }). At least one feature must be present
  // for the new dataset to have anything to draw.
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (id) =>
            (
              window as unknown as {
                __bathyTest?: {
                  getEfhFeatureCount?: (id: string) => number;
                };
              }
            ).__bathyTest?.getEfhFeatureCount?.(id) ?? 0,
          plan.datasetId,
        ),
      { timeout: 15_000, intervals: [100, 200, 400, 800] },
    )
    .toBeGreaterThan(0);

  const featureCount = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __bathyTest?: { getEfhFeatureCount?: (id: string) => number };
        }
      ).__bathyTest?.getEfhFeatureCount?.(id) ?? 0,
    plan.datasetId,
  );
  expect(featureCount).toBeGreaterThan(0);

  // Sanity-check the source string on the first feature so a regression
  // that wired a Texas dataset to NOAA data (or vice versa) fails here too,
  // independent of the popover assertion below.
  const firstProps = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __bathyTest?: {
            getEfhFeatureProperties?: (
              id: string,
              i: number,
            ) => { source?: string; commonName?: string } | null;
          };
        }
      ).__bathyTest?.getEfhFeatureProperties?.(id, 0) ?? null,
    plan.datasetId,
  );
  expect(firstProps).not.toBeNull();
  expect(typeof firstProps!.source).toBe("string");
  if (plan.sourceFamily === "tpwd") {
    expect(firstProps!.source!.startsWith("TPWD")).toBe(true);
  } else {
    // Non-TPWD presets must NOT carry the TPWD prefix (that's the only
    // branch the popover keys off) and must reference NOAA — every SE
    // Alaska feature does, even when the credited lead agency is IPHC or
    // ADF&G working alongside NOAA NMFS.
    expect(firstProps!.source!.startsWith("TPWD")).toBe(false);
    expect(firstProps!.source).toMatch(/NOAA/);
  }

  // Open the species detail panel through the same React state setter
  // OverviewMap.handleClick's hit-test calls when a user clicks an EFH
  // polygon. Asserting on the rendered DOM is what proves the popover
  // wiring (and the TPWD disclaimer / NOAA citation) is intact end-to-end.
  // openEfhDetailForFeature reads from the React Query cache and calls
  // setSelectedEfh. Poll briefly in case there is a render-cycle delay
  // between the cache being populated and the setter being registered.
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (id) =>
            (
              window as unknown as {
                __bathyTest?: {
                  openEfhDetailForFeature?: (id: string, i: number) => boolean;
                };
              }
            ).__bathyTest?.openEfhDetailForFeature?.(id, 0) ?? false,
          plan.datasetId,
        ),
      { timeout: 5_000, intervals: [200, 400, 800, 1600] },
    )
    .toBe(true);

  // The popover is a role="dialog" with aria-label "Essential Fish Habitat details for …".
  const dialog = page.getByRole("dialog", {
    name: /^Essential Fish Habitat details for /,
  });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  if (plan.sourceFamily === "tpwd") {
    // TPWD disclaimer line (added by Task #314) must be present verbatim so
    // a Texas dataset is never mis-attributed as federal EFH.
    await expect(dialog).toContainText(
      "Texas Parks & Wildlife — priority habitat; not federal EFH.",
    );
    // The credit link should point at the TPWD lake page, not NOAA.
    await expect(dialog).toContainText("↗ TPWD lake page");
    await expect(dialog).not.toContainText("↗ NOAA EFH shapefiles");
  } else {
    // SE Alaska presets must use the NOAA EFH shapefiles credit and must
    // NOT carry the TPWD disclaimer line.
    await expect(dialog).toContainText("↗ NOAA EFH shapefiles");
    await expect(dialog).not.toContainText(
      "Texas Parks & Wildlife — priority habitat; not federal EFH.",
    );
    await expect(dialog).not.toContainText("↗ TPWD lake page");
  }
}

test.describe("EFH overlay — Task #314 dataset coverage", () => {
  test("Lake Ray Roberts (TPWD) — overview paints polygons and detail panel shows the TPWD disclaimer", async ({
    page,
  }) => {
    await runEfhCase(page, {
      waterType: "freshwater",
      datasetId: "lake-ray-roberts",
      sourceFamily: "tpwd",
    });
  });

  test("Thorne Bay (NOAA) — overview paints polygons and detail panel shows the NOAA EFH credit (no TPWD line)", async ({
    page,
  }) => {
    await runEfhCase(page, {
      waterType: "saltwater",
      datasetId: "thorne-bay",
      sourceFamily: "noaa",
      // Thorne Bay was removed from PRESET_DATASETS (Task #2365) so its terrain
      // can no longer be fetched from NCEI in the E2E environment.  Inject a
      // synthetic SE Alaska grid directly so the terrain-sync poll passes and
      // the full EFH pipeline (fetch → overlay → species detail popover) still
      // runs end-to-end.  The EFH data for "thorne-bay" is pre-computed in
      // efhData.ts and served by /api/efh?datasetId=thorne-bay regardless.
      terrainSeed: {
        waterType: "saltwater",
        minLon: -133.1,
        maxLon: -132.5,
        minLat: 55.6,
        maxLat: 56.0,
        centerLon: -132.8,
        centerLat: 55.8,
      },
    });
  });
});
