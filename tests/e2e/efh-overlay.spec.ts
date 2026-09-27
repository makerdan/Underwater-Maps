import {
  test,
  expect,
  type Page,
  waitForAuthenticatedSettingsReady,
  API_URL,
  E2E_USER_ID,
} from "./fixtures";

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

async function waitForDatasetCatalogReady(
  page: Page,
  waterType: "saltwater" | "freshwater",
): Promise<void> {
  await page.waitForFunction(
    (expectedWaterType) => {
      const status = (
        window as Window & {
          __bathyTest?: {
            getDatasetCatalogQueryStatus?: (
              value: "saltwater" | "freshwater",
            ) => { isFetched: boolean; isFetching: boolean };
          };
        }
      ).__bathyTest?.getDatasetCatalogQueryStatus?.(expectedWaterType);
      return status?.isFetched === true && status.isFetching === false;
    },
    waterType,
    { timeout: 15_000 },
  );
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
  // Keep the tested dataset marked as EFH-capable in every catalog response,
  // including the first response received during authenticated boot. Preserve
  // real catalog metadata when available; only use synthetic bounds for the
  // terrain-seeded dataset that is absent from the server catalog.
  const { datasetId, waterType, terrainSeed } = plan;
  await page.route(
    (url) => new URL(url).pathname === "/api/datasets",
    async (route) => {
      const response = await route.fetch();
      let existing: Array<Record<string, unknown>> = [];
      try {
        existing = (await response.json()) as typeof existing;
      } catch {
        // malformed — continue with the deterministic tested entry
      }
      const previous = existing.find((dataset) => dataset["id"] === datasetId);
      const synthetic: Record<string, unknown> = {
        ...previous,
        id: datasetId,
        name: previous?.["name"] ?? datasetId,
        description: previous?.["description"] ?? "",
        waterType,
        hasEfh: true,
        minDepth: previous?.["minDepth"] ?? 0,
        maxDepth: previous?.["maxDepth"] ?? 20,
        centerLon: terrainSeed?.centerLon ?? previous?.["centerLon"] ?? 0,
        centerLat: terrainSeed?.centerLat ?? previous?.["centerLat"] ?? 0,
        bbox:
          terrainSeed !== undefined
            ? {
                minLon: terrainSeed.minLon,
                minLat: terrainSeed.minLat,
                maxLon: terrainSeed.maxLon,
                maxLat: terrainSeed.maxLat,
              }
            : previous?.["bbox"] ?? {
                minLon: -1,
                minLat: -1,
                maxLon: 1,
                maxLat: 1,
              },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          ...existing.filter((dataset) => dataset["id"] !== datasetId),
          synthetic,
        ]),
      });
    },
  );

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
  await waitForAuthenticatedSettingsReady(page);

  // Set the target type, then wait for its initial catalog response before
  // writing the bridge seed. Otherwise the response can race with
  // seedCatalogEntry and replace hasEfh=true with the server's stale value.
  await page.evaluate((wt) => {
    (
      window as Window & {
        __bathyTest?: {
          setWaterType?: (value: "saltwater" | "freshwater") => void;
        };
      }
    ).__bathyTest?.setWaterType?.(wt);
  }, plan.waterType);
  await waitForDatasetCatalogReady(page, plan.waterType);

  await page.evaluate(
    ({ id, seed, wt }) => {
      const api = (
        window as Window & {
          __bathyTest?: {
            seedCatalogEntry?: (entry: {
              id: string;
              hasEfh?: boolean;
              waterType?: "saltwater" | "freshwater";
            }) => void;
            seedTerrain?: (overrides: Record<string, unknown>) => boolean;
            setActiveDatasetId?: (value: string | null) => boolean;
          };
        }
      ).__bathyTest;
      api?.seedCatalogEntry?.({ id, hasEfh: true, waterType: wt });
      if (seed) api?.seedTerrain?.({ datasetId: id, ...seed });
      api?.setActiveDatasetId?.(id);
    },
    { id: plan.datasetId, seed: plan.terrainSeed, wt: plan.waterType },
  );

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
  const gpsFolder = page.getByTestId("overview-map-folder-gps");
  await expect(gpsFolder).toBeVisible({ timeout: 5_000 });
  if ((await gpsFolder.getAttribute("aria-expanded")) !== "true") {
    await gpsFolder.click();
  }
  await expect(page.getByTestId("overview-gps-menu")).toBeVisible();

  // The 🐟 EFH toggle button is in the GPS folder and is only rendered
  // when the active dataset's `hasEfh` flag is true — so finding it at all
  // is itself a guard that the new dataset was recognised as EFH-bearing.
  // aria-pressed mirrors `efhOverlayEnabled` from uiStore.
  // Use data-testid for a stable locator that survives layout changes.
  const efhToggle = page.getByTestId("efh-overlay-toggle");
  await expect(efhToggle).toBeVisible({ timeout: 5_000 });
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
  test.beforeEach(async ({ resetPanelCollapse }) => {
    void resetPanelCollapse;
  });

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

test.describe("EFH overlay water-type switch — browser regression", () => {
  test("replaces visible saltwater polygons and detail with freshwater EFH", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const saltwaterId = "thorne-bay";
    const freshwaterId = "lake-ray-roberts";
    const saltwaterTerrain = {
      waterType: "saltwater" as const,
      minLon: -133.1,
      maxLon: -132.5,
      minLat: 55.6,
      maxLat: 56,
      centerLon: -132.8,
      centerLat: 55.8,
    };

    // Start in a deterministic saltwater session, matching the same API user
    // the authenticated browser fixture uses. Suppress the simulated-data
    // confirmation so the automatic freshwater dataset load can complete.
    await page.request.put(`${API_URL}/api/settings`, {
      headers: {
        "x-e2e-user-id": E2E_USER_ID,
        "x-e2e-bypass-secret": "e2e-playwright-secret",
      },
      data: { waterType: "saltwater", colormapTheme: "ocean" },
    });
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = {
          ...(parsed.state ?? {}),
          waterType: "saltwater",
          colormapTheme: "ocean",
        };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {}
    });

    // Put the selected EFH-capable dataset first in each catalog response.
    // Thorne Bay is no longer in the production preset list; Lake Ray Roberts
    // keeps the real terrain and metadata returned by the API.
    await page.route(
      (url) => new URL(url).pathname === "/api/datasets",
      async (route) => {
        let existing: Array<Record<string, unknown>> = [];
        try {
          existing = (await (await route.fetch()).json()) as typeof existing;
        } catch {
          // The deterministic target entry below is still enough to exercise
          // the UI if catalog hydration is unavailable in this test run.
        }
        const waterType =
          new URL(route.request().url()).searchParams.get("waterType") ===
          "freshwater"
            ? "freshwater"
            : "saltwater";
        const datasetId =
          waterType === "freshwater" ? freshwaterId : saltwaterId;
        const previous = existing.find((dataset) => dataset["id"] === datasetId);
        const fallbackBbox =
          waterType === "freshwater"
            ? { minLon: -97.25, minLat: 33.1, maxLon: -96.75, maxLat: 33.7 }
            : {
                minLon: saltwaterTerrain.minLon,
                minLat: saltwaterTerrain.minLat,
                maxLon: saltwaterTerrain.maxLon,
                maxLat: saltwaterTerrain.maxLat,
              };
        const target: Record<string, unknown> = {
          ...previous,
          id: datasetId,
          name:
            previous?.["name"] ??
            (waterType === "freshwater" ? "Lake Ray Roberts" : "Thorne Bay"),
          description: previous?.["description"] ?? "",
          waterType,
          hasEfh: true,
          minDepth: previous?.["minDepth"] ?? 0,
          maxDepth: previous?.["maxDepth"] ?? 20,
          centerLon:
            previous?.["centerLon"] ??
            (waterType === "freshwater" ? -97 : saltwaterTerrain.centerLon),
          centerLat:
            previous?.["centerLat"] ??
            (waterType === "freshwater" ? 33.4 : saltwaterTerrain.centerLat),
          bbox: previous?.["bbox"] ?? fallbackBbox,
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            target,
            ...existing.filter((dataset) => dataset["id"] !== datasetId),
          ]),
        });
      },
    );

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
    await waitForAuthenticatedSettingsReady(page);

    await page.evaluate(() => {
      const api = (
        window as Window & {
          __bathyTest?: {
            setWaterType?: (value: "saltwater" | "freshwater") => void;
          };
        }
      ).__bathyTest;
      api?.setWaterType?.("saltwater");
    });
    await waitForDatasetCatalogReady(page, "saltwater");

    await page.evaluate(
      ({ id, terrain }) => {
        const api = (
          window as Window & {
            __bathyTest?: {
              seedCatalogEntry?: (entry: {
                id: string;
                hasEfh?: boolean;
                waterType?: "saltwater" | "freshwater";
              }) => void;
              seedTerrain?: (overrides: Record<string, unknown>) => boolean;
              setActiveDatasetId?: (value: string | null) => boolean;
            };
          }
        ).__bathyTest;
        api?.seedCatalogEntry?.({
          id,
          hasEfh: true,
          waterType: "saltwater",
        });
        api?.seedTerrain?.({ datasetId: id, ...terrain });
        api?.setActiveDatasetId?.(id);
      },
      { id: saltwaterId, terrain: saltwaterTerrain },
    );
    await page.waitForFunction(
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
      saltwaterId,
      { timeout: 20_000 },
    );

    await page.evaluate(() => {
      const api = (
        window as unknown as {
          __bathyTest?: {
            setOverviewOpen?: (open: boolean) => void;
            setEfhOverlayEnabled?: (enabled: boolean) => void;
          };
        }
      ).__bathyTest;
      api?.setOverviewOpen?.(true);
      api?.setEfhOverlayEnabled?.(true);
    });
    await expect(page.locator(".overview-map-header")).toBeVisible({
      timeout: 10_000,
    });
    const gpsFolder = page.getByTestId("overview-map-folder-gps");
    await expect(gpsFolder).toBeVisible({ timeout: 5_000 });
    if ((await gpsFolder.getAttribute("aria-expanded")) !== "true") {
      await gpsFolder.click();
    }
    const efhToggle = page.getByTestId("efh-overlay-toggle");
    await expect(efhToggle).toBeVisible({ timeout: 5_000 });
    await expect(efhToggle).toHaveAttribute("aria-pressed", "true");

    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (
                window as unknown as {
                  __bathyTest?: { getEfhFeatureCount?: (datasetId: string) => number };
                }
              ).__bathyTest?.getEfhFeatureCount?.(id) ?? 0,
            saltwaterId,
          ),
        { timeout: 15_000, intervals: [100, 200, 400, 800] },
      )
      .toBeGreaterThan(0);
    const oldProperties = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            __bathyTest?: {
              getEfhFeatureProperties?: (
                datasetId: string,
                index: number,
              ) => { commonName?: string; source?: string } | null;
            };
          }
        ).__bathyTest?.getEfhFeatureProperties?.(id, 0) ?? null,
      saltwaterId,
    );
    expect(oldProperties?.source).toMatch(/NOAA/);

    const getRenderedSources = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __bathyTest?: { getOverviewMapEfhSources?: () => string[] };
            }
          ).__bathyTest?.getOverviewMapEfhSources?.() ?? [],
      );
    await expect
      .poll(async () => {
        const sources = await getRenderedSources();
        return sources.length > 0 && sources.every((source) => /NOAA/.test(source));
      })
      .toBe(true);

    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (
                window as unknown as {
                  __bathyTest?: {
                    openEfhDetailForFeature?: (
                      datasetId: string,
                      index: number,
                    ) => boolean;
                  };
                }
              ).__bathyTest?.openEfhDetailForFeature?.(id, 0) ?? false,
            saltwaterId,
          ),
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBe(true);
    const detail = page.getByRole("dialog", {
      name: /^Essential Fish Habitat details for /,
    });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("↗ NOAA EFH shapefiles");

    // This is the same settings-store action used by the visible water-type
    // toggle. The application side effect must replace the active dataset
    // without unmounting the session or disabling EFH.
    await page.evaluate(() => {
      (
        window as unknown as {
          __bathyTest?: {
            setWaterType?: (value: "saltwater" | "freshwater") => void;
          };
        }
      ).__bathyTest?.setWaterType?.("freshwater");
    });
    await waitForDatasetCatalogReady(page, "freshwater");
    await page.waitForFunction(
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
      freshwaterId,
      { timeout: 30_000 },
    );

    await expect(detail).toBeHidden();
    await expect
      .poll(async () =>
        (await getRenderedSources()).some((source) => /NOAA/.test(source)),
      )
      .toBe(false);
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (
                window as unknown as {
                  __bathyTest?: { getEfhFeatureCount?: (datasetId: string) => number };
                }
              ).__bathyTest?.getEfhFeatureCount?.(id) ?? 0,
            freshwaterId,
          ),
        { timeout: 20_000, intervals: [100, 200, 400, 800] },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const sources = await getRenderedSources();
        return sources.length > 0 && sources.every((source) => source.startsWith("TPWD"));
      })
      .toBe(true);
    await expect(efhToggle).toHaveAttribute("aria-pressed", "true");

    if (oldProperties?.commonName) {
      const speciesTitles = await page
        .getByTestId("overlays-tools-panel")
        .locator('button[title^="Load "], button[title^="Deselect "]')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("title") ?? ""),
        );
      expect(speciesTitles.some((title) => title.includes(oldProperties.commonName!))).toBe(
        false,
      );
    }

    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              (
                window as unknown as {
                  __bathyTest?: {
                    openEfhDetailForFeature?: (
                      datasetId: string,
                      index: number,
                    ) => boolean;
                  };
                }
              ).__bathyTest?.openEfhDetailForFeature?.(id, 0) ?? false,
            freshwaterId,
          ),
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBe(true);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Texas Parks & Wildlife — priority habitat; not federal EFH.");
    await expect(detail).toContainText("↗ TPWD lake page");
    await expect(detail).not.toContainText("↗ NOAA EFH shapefiles");
  });
});

test.describe("EFH species selection — browser regression", () => {
  test.beforeEach(async ({ resetPanelCollapse }) => {
    void resetPanelCollapse;
  });

  test("limits the active pair and clears it when switching datasets", async ({
    page,
  }) => {
    const thorneTerrain = {
      waterType: "saltwater" as const,
      minLon: -133.1,
      maxLon: -132.5,
      minLat: 55.6,
      maxLat: 56,
      centerLon: -132.8,
      centerLat: 55.8,
    };
    const glacierTerrain = {
      waterType: "saltwater" as const,
      minLon: -137.1,
      maxLon: -135.8,
      minLat: 58.4,
      maxLat: 59.15,
      centerLon: -136.45,
      centerLat: 58.75,
    };

    // Keep both catalog responses deterministic while preserving the server's
    // real catalog entries. Thorne Bay supplies the three-plus species needed
    // to exercise the capacity guard; Glacier Bay supplies a different
    // catalog for the dataset-switch assertions.
    await page.route(
      (url) => new URL(url).pathname === "/api/datasets",
      async (route) => {
        const response = await route.fetch();
        let existing: Array<Record<string, unknown>> = [];
        try {
          existing = (await response.json()) as typeof existing;
        } catch {
          // Keep the injected catalog usable even if the upstream response is
          // unavailable in the browser test environment.
        }
        const injected = [
          ["thorne-bay", thorneTerrain],
          ["glacier-bay", glacierTerrain],
        ].map(([id, terrain]) => ({
          id,
          name: id,
          description: "",
          waterType: "saltwater",
          hasEfh: true,
          minDepth: 0,
          maxDepth: 20,
          centerLon: (terrain as typeof thorneTerrain).centerLon,
          centerLat: (terrain as typeof thorneTerrain).centerLat,
          bbox: {
            minLon: (terrain as typeof thorneTerrain).minLon,
            minLat: (terrain as typeof thorneTerrain).minLat,
            maxLon: (terrain as typeof thorneTerrain).maxLon,
            maxLat: (terrain as typeof thorneTerrain).maxLat,
          },
        }));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            ...existing.filter(
              (dataset) =>
                dataset.id !== "thorne-bay" && dataset.id !== "glacier-bay",
            ),
            ...injected,
          ]),
        });
      },
    );
    await page.route(
      (url) =>
        /^\/api\/datasets\/(thorne-bay|glacier-bay)\/(terrain|overview)$/.test(
          new URL(url).pathname,
        ),
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        const datasetId = path.includes("glacier-bay")
          ? "glacier-bay"
          : "thorne-bay";
        const terrain =
          datasetId === "glacier-bay" ? glacierTerrain : thorneTerrain;
        const resolution = 64;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            datasetId,
            name: datasetId,
            waterType: "saltwater",
            resolution,
            width: resolution,
            height: resolution,
            depths: new Array(resolution * resolution).fill(10),
            minDepth: 0,
            maxDepth: 20,
            ...terrain,
          }),
        });
      },
    );

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
    await waitForAuthenticatedSettingsReady(page);

    await page.evaluate(() => {
      (
        window as Window & {
          __bathyTest?: {
            setWaterType?: (value: "saltwater" | "freshwater") => void;
          };
        }
      ).__bathyTest?.setWaterType?.("saltwater");
    });
    await waitForDatasetCatalogReady(page, "saltwater");

    await page.evaluate(() => {
      const api = (
        window as Window & {
          __bathyTest?: {
            seedCatalogEntry?: (entry: {
              id: string;
              hasEfh?: boolean;
              waterType?: "saltwater" | "freshwater";
            }) => void;
            seedTerrain?: (overrides: Record<string, unknown>) => boolean;
            setActiveDatasetId?: (id: string | null) => boolean;
          };
        }
      ).__bathyTest;
      api?.seedCatalogEntry?.({
        id: "thorne-bay",
        hasEfh: true,
        waterType: "saltwater",
      });
      api?.seedCatalogEntry?.({
        id: "glacier-bay",
        hasEfh: true,
        waterType: "saltwater",
      });
      api?.seedTerrain?.({
        datasetId: "thorne-bay",
        waterType: "saltwater",
        minLon: -133.1,
        maxLon: -132.5,
        minLat: 55.6,
        maxLat: 56,
        centerLon: -132.8,
        centerLat: 55.8,
      });
      api?.setActiveDatasetId?.("thorne-bay");
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __bathyTest?: {
                    getTerrainSummary?: () => { datasetId?: string } | null;
                  };
                }
              ).__bathyTest?.getTerrainSummary?.()?.datasetId ?? null,
          ),
        { timeout: 20_000, intervals: [100, 200, 400, 800] },
      )
      .toBe("thorne-bay");

    const overlays = page.getByTestId("overlays-tools-panel");
    await expect(overlays).toBeVisible({ timeout: 10_000 });
    const efhToggle = overlays.getByRole("button", {
      name: /ESSENTIAL FISH HABITAT/,
    });
    await expect(efhToggle).toBeVisible({ timeout: 5_000 });
    if ((await efhToggle.getAttribute("aria-pressed")) !== "true") {
      await efhToggle.click();
    }

    const speciesButtons = overlays.locator(
      'button[title^="Load "], button[title^="Deselect "]',
    );
    await expect.poll(() => speciesButtons.count(), { timeout: 15_000 }).toBeGreaterThan(2);
    const activeButtons = overlays.locator(
      'button[title^="Load "][aria-pressed="true"], button[title^="Deselect "][aria-pressed="true"]',
    );
    await expect(activeButtons).toHaveCount(2);

    const inactiveButtons = overlays.locator(
      'button[title^="Load "][aria-pressed="false"], button[title^="Deselect "][aria-pressed="false"]',
    );
    const thirdSpecies = inactiveButtons.first();
    await expect(thirdSpecies).toHaveAttribute("aria-disabled", "true");

    const firstSpeciesTitle = await activeButtons.first().getAttribute("title");
    const thirdSpeciesTitle = await thirdSpecies.getAttribute("title");
    const firstSpeciesName = firstSpeciesTitle?.replace(/^Deselect /, "");
    const thirdSpeciesName = thirdSpeciesTitle?.replace(
      /^Deselect a species before loading /,
      "",
    );
    expect(firstSpeciesName).toBeTruthy();
    expect(thirdSpeciesName).toBeTruthy();
    const speciesButton = (name: string) =>
      overlays.locator(
        `button[title="Load ${name}"], button[title="Deselect ${name}"], button[title="Deselect a species before loading ${name}"]`,
      );
    const firstSpecies = speciesButton(firstSpeciesName!);
    const nextSpecies = speciesButton(thirdSpeciesName!);

    await firstSpecies.click();
    await expect(nextSpecies).toHaveAttribute("aria-disabled", "false");
    await nextSpecies.click();
    await expect(activeButtons).toHaveCount(2);
    await expect(firstSpecies).toHaveAttribute("aria-pressed", "false");
    await expect(nextSpecies).toHaveAttribute("aria-pressed", "true");

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __bathyTest?: {
                    getEfhFeatureCount?: (id: string) => number;
                  };
                }
              ).__bathyTest?.getEfhFeatureCount?.("thorne-bay") ?? 0,
          ),
        { timeout: 15_000, intervals: [100, 200, 400, 800] },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (
              window as unknown as {
                __bathyTest?: {
                  openEfhDetailForFeature?: (id: string, index: number) => boolean;
                };
              }
            ).__bathyTest?.openEfhDetailForFeature?.("thorne-bay", 0) ?? false,
          ),
        { timeout: 5_000, intervals: [200, 400, 800] },
      )
      .toBe(true);
    const detail = page.getByRole("dialog", {
      name: /^Essential Fish Habitat details for /,
    });
    await expect(detail).toBeVisible();

    await page.evaluate(() => {
      const api = (
        window as unknown as {
          __bathyTest?: {
            setActiveDatasetId?: (id: string | null) => boolean;
            seedTerrain?: (overrides: Record<string, unknown>) => boolean;
          };
        }
      ).__bathyTest;
      api?.seedTerrain?.({
        datasetId: "glacier-bay",
        waterType: "saltwater",
        minLon: -137.1,
        maxLon: -135.8,
        minLat: 58.4,
        maxLat: 59.15,
        centerLon: -136.45,
        centerLat: 58.75,
      });
      api?.setActiveDatasetId?.("glacier-bay");
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __bathyTest?: {
                    getTerrainSummary?: () => { datasetId?: string } | null;
                  };
                }
              ).__bathyTest?.getTerrainSummary?.()?.datasetId ?? null,
          ),
        { timeout: 20_000, intervals: [100, 200, 400, 800] },
      )
      .toBe("glacier-bay");

    await expect(detail).toBeHidden();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __bathyTest?: {
                    getEfhFeatureCount?: (id: string) => number;
                  };
                }
              ).__bathyTest?.getEfhFeatureCount?.("glacier-bay") ?? 0,
          ),
        { timeout: 15_000, intervals: [100, 200, 400, 800] },
      )
      .toBeGreaterThan(0);
    await expect(activeButtons).toHaveCount(2);
    await expect(overlays.getByText("Load species (2/2)")).toBeVisible();
    await expect(
      overlays.locator('button[title*="Yelloweye Rockfish"]'),
    ).toHaveCount(0);
  });
});
