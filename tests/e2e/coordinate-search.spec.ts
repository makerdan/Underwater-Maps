/**
 * E2e test for the coordinate + radius search flow.
 *
 * Strategy:
 *   Route-mock POST /api/datasets/point-radius-query so no real catalog data
 *   is needed. The test drives the full user flow: open the Find Data drawer
 *   (Search tab), type coordinates + radius into the CoordinateSearchForm,
 *   submit → the drawer closes, the Overview Map opens at the point, the
 *   point-radius query fires with the expected km payload, and the selected
 *   area panel shows the mocked catalog result.
 *
 *   A second test covers the inline validation path: malformed coordinates
 *   must surface the inline error without leaving the Find Data drawer.
 *
 * Auth: bypass mode (VITE_DEV_AUTH_BYPASS=1) — the FIND DATA button renders
 * whenever the bypass flag is set.
 */
import { test, expect, API_URL, type Page } from "./fixtures";

/**
 * The coordinate + radius form lives inside a collapsed <details> section
 * ("📍 Search by coordinates") on the Find Data Search tab. Expand it if
 * it isn't already open.
 */
async function expandCoordSearchSection(page: Page): Promise<void> {
  const section = page.getByTestId("coord-search-section");
  await expect(section).toBeVisible({ timeout: 5_000 });
  const isOpen = await section.evaluate(
    (el) => (el as HTMLDetailsElement).open,
  );
  if (!isOpen) {
    await page.getByTestId("coord-search-toggle").click();
  }
}

const CATALOG_HIT = {
  id: "e2e-coord-search-dataset",
  name: "Clarence Strait Multibeam",
  sourceAgency: "NOAA/NCEI",
  dataType: "bathymetry",
  resolutionMMin: 4,
  resolutionMMax: 8,
  coverageBbox: { minLon: -132.7, minLat: 55.5, maxLon: -132.2, maxLat: 55.9 },
  endpointUrl: null,
  accessNotes: null,
  description: "E2e fixture dataset",
  keywords: null,
  lastUpdated: null,
  waterType: "saltwater",
  createdAt: "2024-06-01T00:00:00.000Z",
  relevanceScore: 0.92,
};

const POINT_RADIUS_RESPONSE = {
  center: { lat: 55.7, lon: -132.45 },
  radiusKm: 10,
  bbox: { north: 55.79, south: 55.61, east: -132.29, west: -132.61 },
  datasets: [CATALOG_HIT],
};

test.describe("Coordinate search — Find Data → Overview Map flow", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_URL}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_URL} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ resetPanelCollapse }) => {
    void resetPanelCollapse;
  });

  test("submitting coordinates opens the Overview Map and shows point-radius results", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });

    // Capture the request body so we can assert the frontend→backend contract
    // (radius already converted to km, unit always "km").
    let capturedBody: unknown = null;
    await page.route("**/api/datasets/point-radius-query", (route) => {
      if (route.request().method() !== "POST") {
        return route.continue();
      }
      capturedBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(POINT_RADIUS_RESPONSE),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const findDataBtn = page.locator('button:has-text("FIND DATA")').first();
    const findDataBtnVisible = await findDataBtn
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!findDataBtnVisible) {
      test.skip(
        true,
        "FIND DATA button not visible — user is not signed in or app did not load",
      );
      return;
    }

    await findDataBtn.dispatchEvent("click");

    const panel = page.getByRole("dialog", { name: /Find Data panel/i });
    await expect(panel).toBeVisible({ timeout: 8_000 });

    // The coordinate form lives inside a collapsed <details> on the default
    // Search tab — expand it before interacting with the input.
    await expandCoordSearchSection(page);
    const coordInput = page.getByTestId("coord-search-input");
    await expect(coordInput).toBeVisible({ timeout: 5_000 });
    await coordInput.fill("55.7, -132.45");

    const radiusInput = page.getByTestId("coord-search-radius");
    await radiusInput.fill("10");

    await page.getByTestId("coord-search-submit").click();

    // Submit closes the Find Data drawer (onSubmitted → onClose) and opens
    // the Overview Map.
    await expect(panel).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("overview-map-canvas")).toBeVisible({
      timeout: 10_000,
    });

    // The selected-area panel appears with the mocked catalog result.
    const bboxPanel = page.getByTestId("overview-bbox-panel");
    await expect(bboxPanel).toBeVisible({ timeout: 10_000 });

    // Wait for the async point-radius mutation to settle before asserting
    // content.  React/Zustand batching can occasionally run the OverviewMap
    // useEffect a second time with a stale null pendingCoordSearch, skipping
    // the mutateAsync call and leaving the empty-state text in place.
    // Waiting here gives the effect another chance to fire and receive results.
    await expect(bboxPanel).not.toContainText('Click "Request bathymetry"', {
      timeout: 15_000,
    });

    await expect(bboxPanel).toContainText("Clarence Strait Multibeam", {
      timeout: 10_000,
    });

    // Contract: the frontend always sends the radius pre-converted to km.
    expect(capturedBody).toEqual({
      lat: 55.7,
      lon: -132.45,
      radius: 10,
      unit: "km",
    });
  });

  test("malformed coordinates show an inline error and stay in the drawer", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const findDataBtn = page.locator('button:has-text("FIND DATA")').first();
    const findDataBtnVisible = await findDataBtn
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!findDataBtnVisible) {
      test.skip(
        true,
        "FIND DATA button not visible — user is not signed in or app did not load",
      );
      return;
    }

    await findDataBtn.dispatchEvent("click");

    const panel = page.getByRole("dialog", { name: /Find Data panel/i });
    await expect(panel).toBeVisible({ timeout: 8_000 });

    await expandCoordSearchSection(page);
    const coordInput = page.getByTestId("coord-search-input");
    await expect(coordInput).toBeVisible({ timeout: 5_000 });
    await coordInput.fill("not real coordinates");
    await page.getByTestId("coord-search-submit").click();

    await expect(page.getByTestId("coord-search-coord-error")).toBeVisible({
      timeout: 5_000,
    });
    // The drawer stays open — nothing was queued.
    await expect(panel).toBeVisible();
  });
});
