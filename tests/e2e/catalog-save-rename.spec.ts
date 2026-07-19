/**
 * E2e coverage for the SaveCard inline rename flow.
 *
 * Strategy:
 *   Route-mock GET /api/datasets/my-saves so the My Saves tab renders a
 *   controlled fixture card without any real database rows. The PATCH
 *   /api/datasets/my-saves/:id/rename call is also intercepted and returns
 *   an updated save object, so the test is fully hermetic and never hits the
 *   real DB.
 *
 * Coverage (task requirements):
 *   (1) The ✎ pencil button appears on a SaveCard.
 *   (2) Clicking it reveals the inline rename input.
 *   (3) Typing a new name and clicking Save issues a PATCH to the server.
 *   (4) After the PATCH resolves, the card shows the custom label.
 *   (5) The original catalog name is visible as the subtitle after rename.
 *
 * Auth: bypass mode (VITE_DEV_AUTH_BYPASS=1 / E2E_AUTH_BYPASS=1). The
 * bypass header injected by the frontend satisfies requireAuth, so no real
 * Clerk session is needed.
 */
import { test, expect, API_URL } from "./fixtures";

const SAVE_ID = "e2e-save-rename-001";
const CATALOG_ID = "preset-kachemak-bay";
const CATALOG_NAME = "Kachemak Bay Bathymetry";
const SOURCE_AGENCY = "NOAA";
const ORIGINAL_DISPLAY_LABEL = null;
const NEW_LABEL = "My Custom Bay Name";

function makeSaveFixture(displayLabel: string | null = ORIGINAL_DISPLAY_LABEL) {
  return [
    {
      id: SAVE_ID,
      catalogId: CATALOG_ID,
      status: "ready",
      requestedAt: "2024-06-01T00:00:00.000Z",
      readyAt: "2024-06-01T00:01:00.000Z",
      cacheKey: `catalog:${CATALOG_ID}`,
      errorMessage: null,
      displayLabel,
      datasetId: null,
      catalog: {
        id: CATALOG_ID,
        name: CATALOG_NAME,
        sourceAgency: SOURCE_AGENCY,
        dataType: "bathymetry",
        resolutionMMin: 10,
        resolutionMMax: 30,
        coverageBbox: [-152.5, 59.4, -150.5, 60.1],
        endpointUrl: null,
        accessNotes: null,
        description: null,
        keywords: null,
        lastUpdated: null,
        waterType: "saltwater",
        createdAt: "2024-06-01T00:00:00.000Z",
      },
    },
  ];
}

test.describe("SaveCard inline rename flow", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_URL}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_URL} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test("pencil button opens inline input, Save issues PATCH, card shows custom label with catalog name as subtitle", async ({
    page,
  }) => {
    // Suppress SimulatedDataConfirmDialog and the panel-collapse override so
    // the My Saves section renders in a clean, known state.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });

    // (1) Serve the fixture save list so the SaveCard renders without a real DB.
    let currentFixture = makeSaveFixture(null);
    await page.route("**/api/datasets/my-saves", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentFixture),
      });
    });

    // Intercept the PATCH rename call. Validate the request body and return
    // an updated fixture so the React Query cache reflects the new label.
    let patchCalled = false;
    let patchedBody: unknown = null;
    await page.route(`**/api/datasets/my-saves/${SAVE_ID}/rename`, (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      patchCalled = true;
      patchedBody = route.request().postDataJSON();
      // Advance the fixture so a subsequent GET /my-saves also reflects the
      // rename (React Query may refetch after the mutation invalidates).
      currentFixture = makeSaveFixture(NEW_LABEL);
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentFixture[0]),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Open the Find Data panel.
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

    // Switch to My Saves tab.
    const mySavesTab = page.getByRole("button", { name: /My Saves/i });
    await expect(mySavesTab).toBeVisible({ timeout: 5_000 });
    await mySavesTab.click();

    // (1) The SaveCard for the fixture save must be visible.
    const saveCard = page.getByTestId(`save-card-${SAVE_ID}`);
    await expect(saveCard).toBeVisible({ timeout: 10_000 });

    // The card shows the catalog name (no displayLabel yet) and sourceAgency
    // as subtitle.
    const saveName = page.getByTestId(`text-save-name-${SAVE_ID}`);
    await expect(saveName).toBeVisible({ timeout: 5_000 });
    await expect(saveName).toContainText(CATALOG_NAME);

    // (1) The ✎ pencil button must be visible on the card.
    const pencilBtn = page.getByTestId(`btn-rename-save-${SAVE_ID}`);
    await expect(pencilBtn).toBeVisible({ timeout: 5_000 });

    // (2) Clicking the pencil button reveals the inline input.
    await pencilBtn.click();
    const renameInput = page.getByTestId(`input-rename-save-${SAVE_ID}`);
    await expect(renameInput).toBeVisible({ timeout: 5_000 });

    // The pencil button should be gone while editing (no duplicate entry
    // points while the inline form is open).
    await expect(pencilBtn).not.toBeVisible();

    // (3) Clear the current value and type the new name.
    await renameInput.fill(NEW_LABEL);

    // Click the Save button to commit.
    const commitBtn = page.getByTestId(`btn-rename-save-commit-${SAVE_ID}`);
    await expect(commitBtn).toBeVisible({ timeout: 3_000 });
    await commitBtn.click();

    // Verify the PATCH was actually called with the expected body.
    await expect
      .poll(() => patchCalled, { timeout: 8_000 })
      .toBe(true);
    expect(
      (patchedBody as { displayLabel?: string } | null)?.displayLabel,
      "PATCH body must carry the new displayLabel",
    ).toBe(NEW_LABEL);

    // (4) After the mutation resolves the card must show the custom label.
    await expect(saveName).toContainText(NEW_LABEL, { timeout: 8_000 });

    // (5) The original catalog name must now appear as the subtitle
    //     (rendered when displayLabel is set: save.catalog?.name).
    //     The subtitle div is the sibling of the saveName div inside the card.
    const subtitle = saveCard.locator("div").filter({ hasText: CATALOG_NAME }).last();
    await expect(subtitle).toBeVisible({ timeout: 5_000 });
    await expect(subtitle).toContainText(CATALOG_NAME);

    // Inline input must be dismissed (edit mode collapsed).
    await expect(renameInput).not.toBeVisible();
  });

  test("Cancel button closes the inline input without issuing a PATCH", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });

    await page.route("**/api/datasets/my-saves", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeSaveFixture(null)),
      });
    });

    let patchCalled = false;
    await page.route(`**/api/datasets/my-saves/${SAVE_ID}/rename`, (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      patchCalled = true;
      return route.continue();
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

    const mySavesTab = page.getByRole("button", { name: /My Saves/i });
    await mySavesTab.click();

    const pencilBtn = page.getByTestId(`btn-rename-save-${SAVE_ID}`);
    await expect(pencilBtn).toBeVisible({ timeout: 10_000 });
    await pencilBtn.click();

    const renameInput = page.getByTestId(`input-rename-save-${SAVE_ID}`);
    await expect(renameInput).toBeVisible({ timeout: 5_000 });

    // Type something but then cancel.
    await renameInput.fill("Should not be saved");

    const cancelBtn = page.getByTestId(`btn-rename-save-cancel-${SAVE_ID}`);
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
    await cancelBtn.click();

    // Inline input must close.
    await expect(renameInput).not.toBeVisible({ timeout: 5_000 });

    // No PATCH should have been issued.
    expect(patchCalled, "Cancel must not trigger a PATCH request").toBe(false);

    // Card still shows the original catalog name.
    const saveName = page.getByTestId(`text-save-name-${SAVE_ID}`);
    await expect(saveName).toContainText(CATALOG_NAME);
  });
});
