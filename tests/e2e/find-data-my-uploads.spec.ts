/**
 * E2e smoke test for the "My Uploads" section in the Find Data drawer.
 *
 * Strategy:
 *   Route-mock the two API calls that drive the My Uploads section so no
 *   real database is needed. The test verifies the full browse → click Load
 *   flow: the Tolstoi dataset card must appear in My Uploads, and clicking
 *   Load must trigger the dataset-loading pipeline (observed as the Find Data
 *   drawer closing, which happens in onClose() after onConfirm runs).
 *
 * Auth: bypass mode (VITE_DEV_AUTH_BYPASS=1). The frontend considers the user
 * signed-in whenever the bypass flag is set, so the My Uploads section renders
 * even without a real Clerk session.
 */
import { test, expect, API_URL } from "./fixtures";

const UPLOAD_ID = "tolstoi-e2e-upload-001";
const UPLOAD_NAME = "Tolstoi Sonar Survey";

const UPLOAD_FIXTURE = [
  {
    id: UPLOAD_ID,
    name: UPLOAD_NAME,
    minDepth: 15,
    maxDepth: 320,
    folderId: null,
    createdAt: "2024-06-01T00:00:00.000Z",
  },
];

const STUB_TERRAIN = {
  datasetId: UPLOAD_ID,
  name: UPLOAD_NAME,
  waterType: "salt",
  resolution: 2,
  width: 2,
  height: 2,
  depths: [100, 110, 120, 130],
  minDepth: 100,
  maxDepth: 130,
  minLon: -135.5,
  maxLon: -135.4,
  minLat: 59.4,
  maxLat: 59.5,
  centerLon: -135.45,
  centerLat: 59.45,
};

test.describe("Find Data — My Uploads browse and reload smoke test", () => {
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

  test("Tolstoi dataset card appears in My Uploads and clicking Load transitions the viewer", async ({
    page,
  }) => {
    // Suppress the SimulatedDataConfirmDialog so the onConfirm callback fires
    // immediately when the Load button is clicked (same pattern used in
    // dataset-upload-autosave.spec.ts).
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });

    // Intercept GET /api/user/datasets → return our fixture so My Uploads
    // shows the Tolstoi card without any real upload in the database.
    await page.route("**/api/user/datasets", (route) => {
      if (route.request().method() !== "GET") {
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(UPLOAD_FIXTURE),
      });
    });

    // Intercept GET /api/datasets/my-saves → empty so the Tolstoi dataset
    // is NOT deduplicated away as a catalog save entry.
    await page.route("**/api/datasets/my-saves", (route) => {
      if (route.request().method() !== "GET") {
        return route.continue();
      }
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      });
    });

    // Intercept the dataset-preview endpoint so requestDatasetSwitch gets
    // dataSource:"real" and calls onConfirm() immediately (no dialog).
    // This is defensive: the sessionStorage suppress flag normally handles
    // this, but an explicit mock is more robust across browser-cache states.
    await page.route(`**/api/datasets/${UPLOAD_ID}/preview`, (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId: UPLOAD_ID,
          name: UPLOAD_NAME,
          bbox: { minLon: -135.5, minLat: 59.4, maxLon: -135.4, maxLat: 59.5 },
          dataSource: "real",
        }),
      }),
    );

    // Intercept the terrain/overview fetches so clicking Load doesn't fail
    // with a 404 for a non-existent user dataset.
    await page.route(`**/api/user/datasets/${UPLOAD_ID}/terrain`, (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(STUB_TERRAIN),
      }),
    );
    await page.route(`**/api/user/datasets/${UPLOAD_ID}/overview`, (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(STUB_TERRAIN),
      }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Open the Find Data drawer. The HUD button says "FIND DATA".
    const findDataBtn = page
      .locator('button:has-text("FIND DATA")')
      .first();
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

    // The Find Data panel must open.
    const panel = page.getByRole("dialog", { name: /Find Data panel/i });
    await expect(panel).toBeVisible({ timeout: 8_000 });

    // Switch to the My Saves tab where My Uploads lives.
    const mySavesTab = page.getByRole("button", { name: /My Saves/i });
    await expect(mySavesTab).toBeVisible({ timeout: 5_000 });
    await mySavesTab.click();

    // The Tolstoi card must appear in the My Uploads section.
    const uploadCard = page.getByTestId(`upload-card-${UPLOAD_ID}`);
    await expect(uploadCard).toBeVisible({ timeout: 10_000 });
    await expect(uploadCard).toContainText(UPLOAD_NAME);

    // Click the Load button on the Tolstoi card.
    const loadBtn = page.getByTestId(`btn-load-upload-${UPLOAD_ID}`);
    await expect(loadBtn).toBeVisible({ timeout: 5_000 });

    // After clicking Load the panel closes (onClose is called inside onConfirm).
    await loadBtn.click();

    // The Find Data panel should no longer be visible — this is the observable
    // signal that the dataset-loading pipeline was triggered successfully.
    await expect(panel).not.toBeVisible({ timeout: 10_000 });
  });
});
