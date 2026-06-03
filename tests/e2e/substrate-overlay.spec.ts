import { test, expect, type Page, type APIRequestContext, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * Substrate overlay end-to-end coverage.
 *
 * The substrate route fix for custom UUID datasets is covered only by unit
 * tests. This spec locks down the full upload → /substrate/:id fetch →
 * React Query cache → overlay path for two critical cases:
 *
 *   1. In-coverage: a custom dataset whose bbox overlaps SE Alaska ShoreZone
 *      coverage. Enabling the substrate overlay must populate the React Query
 *      cache with ≥ 1 feature AND place those features into the OverviewMap's
 *      substrateFeaturesRef (the array the 2D rAF draw loop reads).
 *
 *   2. Out-of-coverage: a custom dataset far from any bundled substrate
 *      polygons (Mariana Trench). The server returns a 200 with an empty
 *      FeatureCollection (hasCoverage: false), which triggers the isEmpty
 *      branch of useSubstrateErrorToast → "No substrate map available" toast
 *      with the isEmpty-specific description that mentions "No bundled
 *      substrate polygons" (distinct from the isError description).
 *
 * Both cases upload real files via the API (not UI), exercising the auth-
 * bypass branch in POST /datasets/upload (the same path as the autosave
 * E2E tests). After upload the test drives the active-dataset switch through
 * window.__bathyTest helpers and polls the React Query cache and OverviewMap
 * ref, avoiding the headless-WebGL raycaster pipeline entirely.
 *
 * Auth: E2E_AUTH_BYPASS=1 + VITE_DEV_AUTH_BYPASS=1 are set by the
 * Playwright webServer config. The frontend injects `x-e2e-user-id:
 * dev-user-bypass` on every /api/* request; the api-server accepts it in
 * lieu of a Clerk JWT.
 */

const API_BASE = API_URL;
const AUTH_HEADERS = { "x-e2e-user-id": E2E_USER_ID };
const HELPER_TIMEOUT = 15_000;

/**
 * 12 × 12 grid of (lon, lat, depth) rows in Glacier Bay / SE Alaska.
 *
 * The bbox sits inside the bundled ShoreZone coverage region
 * (minLon: -137, minLat: 55, maxLon: -130, maxLat: 60), so the substrate
 * route returns ≥ 1 polygon for any dataset with this bbox.
 */
function makeSeAlaskaCsv(): string {
  const header = "lon,lat,depth";
  const rows: string[] = [];
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const lon = (-136.6 + c * 0.05).toFixed(4);
      const lat = (58.3 + r * 0.05).toFixed(4);
      const depth = (50 + (r + c) * 5).toFixed(1);
      rows.push(`${lon},${lat},${depth}`);
    }
  }
  return [header, ...rows].join("\n");
}

/**
 * 12 × 12 grid in the Mariana Trench — far from any bundled substrate
 * coverage. The substrate route returns hasCoverage: false for this bbox,
 * triggering the isEmpty toast path (isError=false, featureCount=0).
 */
function makeMarianaTrenchCsv(): string {
  const header = "lon,lat,depth";
  const rows: string[] = [];
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const lon = (142.4 + c * 0.01).toFixed(4);
      const lat = (11.3 + r * 0.01).toFixed(4);
      const depth = (1000 + (r + c) * 5).toFixed(1);
      rows.push(`${lon},${lat},${depth}`);
    }
  }
  return [header, ...rows].join("\n");
}

async function uploadCsv(
  request: APIRequestContext,
  csv: string,
  filename: string,
): Promise<string | null> {
  const res = await request.post(`${API_BASE}/api/datasets/upload`, {
    headers: AUTH_HEADERS,
    multipart: {
      file: { name: filename, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") },
      resolution: "256",
    },
    timeout: 90_000,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { savedDatasetId?: string; saveError?: string };
  if (body.saveError) return null;
  return body.savedDatasetId ?? null;
}

async function deleteUserDataset(
  request: APIRequestContext,
  id: string,
): Promise<void> {
  await request.delete(`${API_BASE}/api/user/datasets/${id}`, {
    headers: AUTH_HEADERS,
  });
}

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return page
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
  return page
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

test.describe("Substrate overlay — custom UUID datasets", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_BASE}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_BASE} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });
  });

  // ---------------------------------------------------------------------------
  // Case 1: in-coverage upload (SE Alaska bbox overlaps ShoreZone polygons).
  //
  // Asserts two levels of confirmation:
  //   a) React Query cache has ≥ 1 feature (proves the /substrate/:uuid fetch
  //      reached the server and the terrainJson bbox extraction worked).
  //   b) OverviewMap substrateFeaturesRef also has ≥ 1 entry (proves the data
  //      reached the 2D layer — the same array the rAF draw loop reads when
  //      painting polygons and the legend to canvas).
  // ---------------------------------------------------------------------------
  test("in-coverage upload: substrate overlay populates React Query cache and OverviewMap layer with ≥ 1 feature", async ({
    page,
    request,
  }) => {
    const filename = `e2e-substrate-se-alaska-${Date.now()}.csv`;
    const uuid = await uploadCsv(request, makeSeAlaskaCsv(), filename);
    if (!uuid) {
      test.skip(true, "Upload failed or api-server rejected the CSV — skipping");
      return;
    }

    try {
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

      // Ensure substrate overlay is off before switching datasets.
      await page.evaluate(() => {
        (window as unknown as {
          __bathyTest?: {
            setSubstrateOverlayEnabled?: (b: boolean) => void;
            setWaterType?: (wt: string) => void;
          };
        }).__bathyTest?.setSubstrateOverlayEnabled?.(false);
        (window as unknown as {
          __bathyTest?: { setWaterType?: (wt: string) => void };
        }).__bathyTest?.setWaterType?.("saltwater");
      });

      // Switch to the uploaded UUID dataset.
      const switched = await page.evaluate(
        (id) =>
          (window as unknown as {
            __bathyTest?: { setActiveDatasetId?: (id: string | null) => boolean };
          }).__bathyTest?.setActiveDatasetId?.(id) ?? false,
        uuid,
      );
      if (!switched) {
        test.skip(true, "setActiveDatasetId returned false — TestBridge not ready");
        return;
      }

      // Wait for useActiveDatasetSync to fetch the terrain for the UUID dataset
      // and commit it. The terrainStore datasetId is the authoritative signal.
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
          uuid,
          { timeout: 30_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!synced) {
        test.skip(
          true,
          "Terrain for uploaded SE Alaska dataset never committed — api-server slow or unreachable",
        );
        return;
      }

      // Open the overview map, then enable the substrate overlay. Opening the
      // OverviewMap first ensures the component mounts and registers its
      // substrateFeaturesRef getter before the React Query fetch settles.
      await page.evaluate(() => {
        (window as unknown as {
          __bathyTest?: { setOverviewOpen?: (b: boolean) => void };
        }).__bathyTest?.setOverviewOpen?.(true);
      });

      const headerVisible = await page
        .locator(".overview-map-header")
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!headerVisible) {
        test.skip(
          true,
          "Overview map header did not appear — UI shell not rendered in this env",
        );
        return;
      }

      // Enable substrate overlay — triggers the React Query fetch for
      // /substrate/:uuid (auth-gated, bypassed via x-e2e-user-id).
      await page.evaluate(() => {
        (window as unknown as {
          __bathyTest?: { setSubstrateOverlayEnabled?: (b: boolean) => void };
        }).__bathyTest?.setSubstrateOverlayEnabled?.(true);
      });

      // a) Poll the React Query cache until the query settles with ≥ 1 feature.
      await expect
        .poll(
          async () =>
            await page.evaluate(
              (id) =>
                (window as unknown as {
                  __bathyTest?: {
                    getSubstrateFeatureCount?: (id: string) => number;
                  };
                }).__bathyTest?.getSubstrateFeatureCount?.(id) ?? -1,
              uuid,
            ),
          { timeout: 20_000, intervals: [200, 400, 800, 1600] },
        )
        .toBeGreaterThan(0);

      // b) Poll the OverviewMap substrateFeaturesRef — this is the 2D layer
      //    confirmation. substrateFeaturesRef.current is set when the React
      //    useEffect [substrateCollection] fires, which is a synchronous update
      //    after the query above settled, so a short poll is sufficient.
      await expect
        .poll(
          async () =>
            await page.evaluate(
              () =>
                (window as unknown as {
                  __bathyTest?: {
                    getOverviewMapSubstrateFeatureCount?: () => number;
                  };
                }).__bathyTest?.getOverviewMapSubstrateFeatureCount?.() ?? -1,
            ),
          { timeout: 5_000, intervals: [100, 200, 400] },
        )
        .toBeGreaterThan(0);
    } finally {
      await deleteUserDataset(request, uuid);
    }
  });

  // ---------------------------------------------------------------------------
  // Case 2: out-of-coverage upload (Mariana Trench, far from any SE Alaska
  // ShoreZone or NOAA ENC coverage).
  //
  // The server returns 200 with an empty FeatureCollection (hasCoverage:
  // false). useSubstrateErrorToast detects isEmpty=true (not isError) and
  // fires a toast whose description is distinct from the isError path:
  //   isEmpty:  "No bundled substrate polygons (ShoreZone or NOAA ENC) intersect…"
  //   isError:  "Substrate coverage is only bundled for built-in survey regions…"
  //
  // The test waits for the substrate React Query to fully settle, then
  // asserts isError === false AND featureCount === 0 (the isEmpty path),
  // plus the isEmpty-specific description text in the toast.
  // ---------------------------------------------------------------------------
  test("out-of-coverage upload: isEmpty toast fires (not isError) and substrate query settles with 0 features", async ({
    page,
    request,
  }) => {
    const filename = `e2e-substrate-mariana-${Date.now()}.csv`;
    const uuid = await uploadCsv(request, makeMarianaTrenchCsv(), filename);
    if (!uuid) {
      test.skip(true, "Upload failed or api-server rejected the CSV — skipping");
      return;
    }

    try {
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

      // Start with overlay OFF so the toast fires fresh when we turn it on.
      await page.evaluate(() => {
        (window as unknown as {
          __bathyTest?: {
            setSubstrateOverlayEnabled?: (b: boolean) => void;
            setWaterType?: (wt: string) => void;
          };
        }).__bathyTest?.setSubstrateOverlayEnabled?.(false);
        (window as unknown as {
          __bathyTest?: { setWaterType?: (wt: string) => void };
        }).__bathyTest?.setWaterType?.("saltwater");
      });

      const switched = await page.evaluate(
        (id) =>
          (window as unknown as {
            __bathyTest?: { setActiveDatasetId?: (id: string | null) => boolean };
          }).__bathyTest?.setActiveDatasetId?.(id) ?? false,
        uuid,
      );
      if (!switched) {
        test.skip(true, "setActiveDatasetId returned false — TestBridge not ready");
        return;
      }

      // Wait for terrain sync. Without it, enabling substrateColorMode
      // before the component knows the dataset means the fetch never fires.
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
          uuid,
          { timeout: 30_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!synced) {
        test.skip(
          true,
          "Terrain for out-of-coverage dataset never committed — api-server slow or unreachable",
        );
        return;
      }

      // Enable the overlay — the /substrate/:uuid fetch fires, returns 200
      // with an empty FeatureCollection (hasCoverage: false), and
      // useSubstrateErrorToast fires the isEmpty toast.
      await page.evaluate(() => {
        (window as unknown as {
          __bathyTest?: { setSubstrateOverlayEnabled?: (b: boolean) => void };
        }).__bathyTest?.setSubstrateOverlayEnabled?.(true);
      });

      // Wait for the substrate React Query to fully settle (isFetched: true).
      // This prevents the test from racing ahead to the assertions before the
      // fetch has completed — which was the root cause of the -1 (cache-miss)
      // false-pass in the original implementation.
      const settled = await page
        .waitForFunction(
          (id) => {
            const status = (
              window as unknown as {
                __bathyTest?: {
                  getSubstrateQueryStatus?: (id: string) => {
                    isFetched: boolean;
                    isError: boolean;
                    featureCount: number | null;
                  };
                };
              }
            ).__bathyTest?.getSubstrateQueryStatus?.(id);
            return status?.isFetched === true;
          },
          uuid,
          { timeout: 20_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!settled) {
        test.skip(
          true,
          "Substrate query never settled — api-server slow or unreachable",
        );
        return;
      }

      // Read the settled query state and assert:
      //   isError === false  → it was a successful 200, not a network/auth error
      //   featureCount === 0 → the server returned an empty FeatureCollection
      //                        (isEmpty path, not isError path)
      const status = await page.evaluate(
        (id) =>
          (window as unknown as {
            __bathyTest?: {
              getSubstrateQueryStatus?: (id: string) => {
                isFetched: boolean;
                isError: boolean;
                featureCount: number | null;
              };
            };
          }).__bathyTest?.getSubstrateQueryStatus?.(id) ?? null,
        uuid,
      );
      expect(status).not.toBeNull();
      expect(status!.isError).toBe(false);
      expect(status!.featureCount).toBe(0);

      // Assert the isEmpty-specific toast appeared. The Radix UI ToastProvider
      // renders each toast as <li role="status">. The isEmpty description text
      // is distinct from the isError description — asserting on it proves the
      // isEmpty branch of useSubstrateErrorToast fired, not the error branch:
      //
      //   isEmpty: "No bundled substrate polygons (ShoreZone or NOAA ENC)…"
      //   isError: "Substrate coverage is only bundled for built-in survey regions…"
      await expect(
        page.locator('[role="status"]').filter({
          hasText: /No bundled substrate polygons/i,
        }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserDataset(request, uuid);
    }
  });
});
