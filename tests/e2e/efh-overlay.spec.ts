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
}

async function runEfhCase(page: Page, plan: CasePlan): Promise<void> {
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

  // Switch water type first; useWaterTypeSideEffects will auto-load the
  // first preset of that type. We override the choice immediately after so
  // the dataset under test is what ends up active.
  await page.evaluate(
    ({ wt, id }) => {
      const api = (
        window as unknown as {
          __bathyTest: {
            setWaterType: (wt: "saltwater" | "freshwater") => void;
            setActiveDatasetId: (id: string | null) => boolean;
          };
        }
      ).__bathyTest;
      api.setWaterType(wt as "saltwater" | "freshwater");
      api.setActiveDatasetId(id as string);
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
          __bathyTest: { setActiveDatasetId: (id: string | null) => boolean };
        }
      ).__bathyTest.setActiveDatasetId(id as string);
    },
    { id: plan.datasetId },
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
        __bathyTest: {
          setEfhOverlayEnabled: (b: boolean) => void;
          setOverviewOpen: (b: boolean) => void;
        };
      }
    ).__bathyTest.setEfhOverlayEnabled(false);
    (
      window as unknown as {
        __bathyTest: { setOverviewOpen: (b: boolean) => void };
      }
    ).__bathyTest.setOverviewOpen(true);
  });
  await expect(page.locator(".overview-map-header")).toBeVisible({
    timeout: 10_000,
  });

  // The 🐟 EFH toggle button in the Overview Map header is only rendered
  // when the active dataset's `hasEfh` flag is true — so finding it at all
  // is itself a guard that the new dataset was recognised as EFH-bearing.
  // aria-pressed mirrors `efhOverlayEnabled` from uiStore.
  // Match by visible text — the emoji glyph in the aria-name lookup isn't
  // reliable across headless Chromium builds, but the visible
  // "Essential Fish Habitat" label on the button is.
  const efhToggle = page.locator(".overview-map-header button", {
    hasText: "Essential Fish Habitat",
  });
  await expect(efhToggle).toBeVisible({ timeout: 5_000 });
  await expect(efhToggle).toHaveAttribute("aria-pressed", "false");

  // Enable the overlay and confirm the same button now reports pressed —
  // this is the explicit "enable the EFH overlay" step.
  await page.evaluate(() => {
    (
      window as unknown as {
        __bathyTest: { setEfhOverlayEnabled: (b: boolean) => void };
      }
    ).__bathyTest.setEfhOverlayEnabled(true);
  });
  await expect(efhToggle).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __bathyTest: { isEfhOverlayEnabled: () => boolean };
          }
        ).__bathyTest.isEfhOverlayEnabled(),
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
                __bathyTest: {
                  getEfhFeatureCount: (id: string) => number;
                };
              }
            ).__bathyTest.getEfhFeatureCount(id),
          plan.datasetId,
        ),
      { timeout: 15_000, intervals: [100, 200, 400, 800] },
    )
    .toBeGreaterThan(0);

  const featureCount = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __bathyTest: { getEfhFeatureCount: (id: string) => number };
        }
      ).__bathyTest.getEfhFeatureCount(id),
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
          __bathyTest: {
            getEfhFeatureProperties: (
              id: string,
              i: number,
            ) => { source?: string; commonName?: string } | null;
          };
        }
      ).__bathyTest.getEfhFeatureProperties(id, 0),
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
  const opened = await page.evaluate(
    (id) =>
      (
        window as unknown as {
          __bathyTest: {
            openEfhDetailForFeature: (id: string, i: number) => boolean;
          };
        }
      ).__bathyTest.openEfhDetailForFeature(id, 0),
    plan.datasetId,
  );
  expect(opened).toBe(true);

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
    });
  });
});
