import { test, expect, type Page, API_URL, E2E_USER_ID } from "./fixtures";

/**
 * RAWS weather popup E2E coverage.
 *
 * Three scenarios:
 *   1. Happy path (real canvas pin click) — verifies the full pin hit-test path
 *      by dispatching a real click event on the OverviewMap canvas at the
 *      actual rendered (cx, cy) of the station pin.
 *   2. ERDDAP unavailable — uses the backdoor state-setter to open the popup
 *      faster and assert the graceful fallback message.
 *   3. Close button — uses the backdoor opener and clicks the × button.
 *
 * API mocking uses page.route() so neither the real ERDDAP proxy nor a live
 * AOOS endpoint is required.
 */

const OVERVIEW_CANVAS_TESTID = "[data-testid='overview-map-canvas']";
const POPOVER_TESTID = "[data-testid='raws-station-popover']";
const RAWS_DATASET_ID = "raws_test_station_e2e";
const RAWS_STATION_NAME = "E2E Test RAWS Station";

const MOCK_STATIONS_RESPONSE = {
  available: true,
  stations: [
    {
      datasetId: RAWS_DATASET_ID,
      name: RAWS_STATION_NAME,
      lat: 61.2,
      lon: -149.9,
    },
  ],
  source: "aoos-raws",
};

const MOCK_WEATHER_AVAILABLE = {
  available: true,
  station: { datasetId: RAWS_DATASET_ID, name: RAWS_STATION_NAME },
  observation: {
    time: "2026-05-31T10:00:00Z",
    airTemperatureC: 14.5,
    windSpeedMs: 3.2,
    windFromDirectionDeg: 180,
    windGustMs: 5.1,
    relativeHumidityPct: 62,
  },
};

const MOCK_WEATHER_UNAVAILABLE = {
  available: false,
};

async function appIsSignedIn(page: Page): Promise<boolean> {
  return page
    .locator("canvas")
    .first()
    .isVisible({ timeout: 12_000 })
    .catch(() => false);
}

async function waitForTestHelpers(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () =>
        typeof (
          window as unknown as { __bathyTest?: unknown }
        ).__bathyTest !== "undefined",
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function waitForRawsHelpers(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const t = (
          window as unknown as {
            __bathyTest?: {
              openRawsPopupForStation?: (id: string) => boolean;
              getRawsCanvasPositions?: () => Array<{
                datasetId: string;
                cx: number;
                cy: number;
              }>;
            };
          }
        ).__bathyTest;
        return !!(
          t &&
          t.openRawsPopupForStation &&
          t.getRawsCanvasPositions
        );
      },
      undefined,
      { timeout: 15_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function openOverviewMap(page: Page): Promise<void> {
  const opened = await page
    .evaluate(() => {
      const api = (
        window as unknown as {
          __bathyTest?: { setOverviewOpen?: (b: boolean) => void };
        }
      ).__bathyTest;
      if (api?.setOverviewOpen) {
        api.setOverviewOpen(true);
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (!opened) {
    const btn = page.getByRole("button", { name: /▲\s*OVERVIEW/ });
    await btn.click();
  }

  await expect(page.locator(".overview-map-header")).toBeVisible({
    timeout: 8_000,
  });
}

async function mockRawsStations(page: Page): Promise<void> {
  await page.route("**/api/raws-stations*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_STATIONS_RESPONSE),
    }),
  );
}

async function enableRawsOverlay(page: Page): Promise<void> {
  // rawsOverlayActive is server-persisted; the async settings hydrate can
  // land after the bridge call and reset it to false, unpainting the pins.
  await page.request.put(`${API_URL}/api/settings`, {
    headers: { "x-e2e-user-id": E2E_USER_ID },
    data: { rawsOverlayActive: true },
  });
  await page.evaluate(() => {
    (
      window as unknown as {
        __bathyTest: { setRawsOverlayActive: (b: boolean) => void };
      }
    ).__bathyTest.setRawsOverlayActive(true);
  });
  // Brief pause for the mocked stations fetch to settle and for the rAF loop
  // to paint the first frame of station pins onto the canvas.
  await page.waitForTimeout(400);
}

/**
 * Seed synthetic terrain centred on the mock RAWS station (61.2 N, -149.9 W —
 * near Anchorage). useRawsStations is gated on centerLat/centerLon being
 * non-null, and without matching terrain bounds the rAF loop projects the
 * station lon/lat outside the drawn area so no pins/positions render.
 */
async function seedRawsTerrain(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.__bathyTest?.seedTerrain?.({
      minLat: 60,
      maxLat: 62.5,
      minLon: -152,
      maxLon: -147.5,
      centerLat: 61.2,
      centerLon: -149.9,
    }),
  ).catch(() => {});
  await page
    .waitForFunction(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
      null,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

test.describe("RAWS weather popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
  });

  // ── Test 1: real canvas pin click ──────────────────────────────────────────
  // This test exercises the full user-facing click path: the overview map
  // renders a RAWS station pin on the canvas, the test reads the actual
  // rendered canvas-space coordinates (cx, cy) via getRawsCanvasPositions(),
  // dispatches a MouseEvent on the canvas element at those coordinates, and
  // verifies that the popover opens with live observation values.
  test("clicking a station pin on the canvas opens the popup with observation values", async ({
    page,
  }) => {
    await mockRawsStations(page);
    await page.route(`**/api/raws-weather*`, (route) => {
      const url = route.request().url();
      if (url.includes(RAWS_DATASET_ID)) {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_WEATHER_AVAILABLE),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — auth bypass inactive");
      return;
    }
    if (!(await waitForTestHelpers(page))) {
      test.skip(
        true,
        "window.__bathyTest not installed — dev test helpers missing",
      );
      return;
    }

    // Seed synthetic terrain centred on the mock RAWS station (61.2 N, -149.9 W —
    // near Anchorage). Without matching terrain bounds the rAF loop projects the
    // station lon/lat onto canvas coordinates that fall outside the drawn area,
    // so renderRawsStations returns no positions and the 8-second poll times out
    // (raws-weather-popup.spec.ts:168).
    await page.evaluate(() =>
      window.__bathyTest?.seedTerrain?.({
        minLat: 60,
        maxLat: 62.5,
        minLon: -152,
        maxLon: -147.5,
        centerLat: 61.2,
        centerLon: -149.9,
      }),
    ).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});

    await openOverviewMap(page);

    expect(
      await waitForRawsHelpers(page),
      "RAWS helpers (openRawsPopupForStation / getRawsCanvasPositions) must be registered by OverviewMap",
    ).toBe(true);

    await enableRawsOverlay(page);

    // Poll until the rAF loop has painted at least one station pin and the
    // canvas-position getter returns a non-empty array containing our station.
    const pinPos = await page.waitForFunction(
      (datasetId) => {
        const positions = (
          window as unknown as {
            __bathyTest: {
              getRawsCanvasPositions: () => Array<{
                datasetId: string;
                cx: number;
                cy: number;
              }>;
            };
          }
        ).__bathyTest.getRawsCanvasPositions();
        return positions.find((p) => p.datasetId === datasetId) ?? null;
      },
      RAWS_DATASET_ID,
      { timeout: 8_000 },
    );

    const pinVal = await pinPos.jsonValue();
    void pinPos; // position confirmed painted — click goes to the SVG pin below

    // Dispatch a real click at the pin's viewport coordinates. RAWS pins are
    // SVG <g> elements rendered in the overlay ABOVE the canvas with their own
    // React onClick — dispatching on the canvas element itself would bypass
    // them. Resolve the topmost element at the point (the pin's hit target)
    // via elementFromPoint and click that, mirroring what a user's pointer hits.
    await expect(page.locator(OVERVIEW_CANVAS_TESTID)).toBeVisible();
    await page.evaluate(
      ({ cx: pinCx, cy: pinCy, testid }) => {
        const canvas = document.querySelector(
          `[data-testid="${testid}"]`,
        ) as HTMLCanvasElement | null;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + pinCx;
        const y = rect.top + pinCy;
        const target = document.elementFromPoint(x, y) ?? canvas;
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      },
      { cx: pinVal.cx, cy: pinVal.cy, testid: "overview-map-canvas" },
    );

    const popover = page.locator(POPOVER_TESTID);
    await expect(popover).toBeVisible({ timeout: 8_000 });

    // Header must identify this as a RAWS station card.
    await expect(popover).toContainText("RAWS Station");

    // Temperature row: 14.5 °C in metric (default settings).
    await expect(popover).toContainText("14.5 °C");

    // Wind row: 3.2 m/s from S (180°).
    await expect(popover).toContainText("3.2 m/s");

    // Humidity row.
    await expect(popover).toContainText("62 %");

    // Source credit must be present.
    await expect(popover).toContainText("AOOS / RAWS");
  });

  // ── Test 2: ERDDAP unavailable fallback ────────────────────────────────────
  test("shows graceful fallback when ERDDAP is unavailable", async ({
    page,
  }) => {
    await mockRawsStations(page);
    await page.route(`**/api/raws-weather*`, (route) => {
      const url = route.request().url();
      if (url.includes(RAWS_DATASET_ID)) {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_WEATHER_UNAVAILABLE),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — auth bypass inactive");
      return;
    }
    if (!(await waitForTestHelpers(page))) {
      test.skip(
        true,
        "window.__bathyTest not installed — dev test helpers missing",
      );
      return;
    }

    // Seed terrain around the mock station: the popover only renders when
    // OverviewMap has an overview grid (overviewGrid gate), which requires
    // loaded terrain.
    await page.evaluate(() =>
      window.__bathyTest?.seedTerrain?.({
        minLat: 60,
        maxLat: 62.5,
        minLon: -152,
        maxLon: -147.5,
        centerLat: 61.2,
        centerLon: -149.9,
      }),
    ).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});

    await openOverviewMap(page);

    expect(
      await waitForRawsHelpers(page),
      "RAWS helpers must be registered by OverviewMap",
    ).toBe(true);

    // Seed terrain near the mock station: useRawsStations is gated on
    // centerLat/centerLon being non-null, and the popover render requires
    // the station to be present in rawsDataRef (populated from that fetch).
    await seedRawsTerrain(page);

    await enableRawsOverlay(page);

    const opened = await page.evaluate((id) => {
      return (
        window as unknown as {
          __bathyTest: { openRawsPopupForStation: (id: string) => boolean };
        }
      ).__bathyTest.openRawsPopupForStation(id);
    }, RAWS_DATASET_ID);

    expect(
      opened,
      "openRawsPopupForStation must return true — OverviewMap setters must be registered",
    ).toBe(true);

    const popover = page.locator(POPOVER_TESTID);
    await expect(popover).toBeVisible({ timeout: 8_000 });

    // Header must still identify this as a RAWS station card.
    await expect(popover).toContainText("RAWS Station");

    // Graceful fallback message — no observation values must appear.
    await expect(popover).toContainText("No recent observation available");

    // No temperature or wind values must leak through.
    await expect(popover).not.toContainText("°C");
    await expect(popover).not.toContainText("m/s");
  });

  // ── Test 3: close button ───────────────────────────────────────────────────
  test("× button closes the popover", async ({ page }) => {
    await mockRawsStations(page);
    await page.route(`**/api/raws-weather*`, (route) => {
      const url = route.request().url();
      if (url.includes(RAWS_DATASET_ID)) {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(MOCK_WEATHER_AVAILABLE),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    if (!(await appIsSignedIn(page))) {
      test.skip(true, "Canvas not visible — auth bypass inactive");
      return;
    }
    if (!(await waitForTestHelpers(page))) {
      test.skip(
        true,
        "window.__bathyTest not installed — dev test helpers missing",
      );
      return;
    }

    // Seed terrain around the mock station: the popover only renders when
    // OverviewMap has an overview grid (overviewGrid gate), which requires
    // loaded terrain.
    await page.evaluate(() =>
      window.__bathyTest?.seedTerrain?.({
        minLat: 60,
        maxLat: 62.5,
        minLon: -152,
        maxLon: -147.5,
        centerLat: 61.2,
        centerLon: -149.9,
      }),
    ).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});

    await openOverviewMap(page);

    expect(
      await waitForRawsHelpers(page),
      "RAWS helpers must be registered by OverviewMap",
    ).toBe(true);

    // Seed terrain near the mock station (see fallback test for rationale).
    await seedRawsTerrain(page);

    await enableRawsOverlay(page);

    const opened = await page.evaluate((id) => {
      return (
        window as unknown as {
          __bathyTest: { openRawsPopupForStation: (id: string) => boolean };
        }
      ).__bathyTest.openRawsPopupForStation(id);
    }, RAWS_DATASET_ID);

    expect(
      opened,
      "openRawsPopupForStation must return true — OverviewMap setters must be registered",
    ).toBe(true);

    const popover = page.locator(POPOVER_TESTID);
    await expect(popover).toBeVisible({ timeout: 8_000 });

    // Click the × close button.
    const closeBtn = popover.getByRole("button", { name: /Close/ });
    await expect(closeBtn).toBeVisible();
    await closeBtn.dispatchEvent("click");

    await expect(popover).toHaveCount(0, { timeout: 5_000 });
  });
});
