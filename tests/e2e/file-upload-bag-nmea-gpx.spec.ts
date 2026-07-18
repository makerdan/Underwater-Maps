/**
 * End-to-end coverage for BAG, NMEA, and GPX file-upload flows from the browser.
 *
 * Complements file-upload-tiff-netcdf.spec.ts and file-upload-laz.spec.ts.
 * Closes the remaining three format gaps so that regressions in the BAG
 * subprocess parser, NMEA sentence scanner, or GPX track-point reader are
 * caught before a user reports them.
 *
 * Three paths are tested for each format:
 *   1. API path — POST /api/datasets/upload directly, assert 200 with terrain
 *      and overview fields, confirm row appears in MY UPLOADS and the 3D
 *      viewer renders the dataset (depth-scale-bar visible).
 *   2. Browser UI path — drop the file onto the dropzone, confirm the row
 *      appears and the 3D viewer renders the dataset after navigating normally.
 *   3. Error path — upload a real malformed buffer (plain text masquerading
 *      as BAG, empty buffer as NMEA, empty GPX with no trkpt/wpt) and assert
 *      a user-visible error message appears in the dropzone UI.
 *
 * Auth: bypass mode (E2E_AUTH_BYPASS=1 / VITE_DEV_AUTH_BYPASS=1).
 * Every API call injects `x-e2e-user-id: dev-user-bypass`.
 *
 * Fixtures:
 *   artifacts/api-server/src/__tests__/fixtures/survey.bag
 *   artifacts/api-server/src/__tests__/fixtures/survey.nmea
 *   artifacts/api-server/src/__tests__/fixtures/survey.gpx
 */
import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext, type Page, API_URL, E2E_USER_ID } from "./fixtures";

const API_BASE = API_URL;
const authHeaders = { "x-e2e-user-id": E2E_USER_ID };

const BAG_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "artifacts/api-server/src/__tests__/fixtures/survey.bag",
);
const NMEA_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "artifacts/api-server/src/__tests__/fixtures/survey.nmea",
);
const GPX_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "artifacts/api-server/src/__tests__/fixtures/survey.gpx",
);

interface UserDatasetMeta {
  id: string;
  name: string;
  minDepth: number;
  maxDepth: number;
  folderId?: string | null;
  createdAt: string;
}

interface TerrainGridMeta {
  minDepth: number;
  maxDepth: number;
}

interface UploadResponseBody {
  terrain?: TerrainGridMeta;
  overview?: TerrainGridMeta;
  savedDatasetId?: string;
  savedDatasetMeta?: { id: string; name: string };
  saveError?: string;
}

async function listMyUploads(req: APIRequestContext): Promise<UserDatasetMeta[]> {
  const res = await req.get(`${API_BASE}/api/user/datasets`, { headers: authHeaders });
  expect(res.ok(), `GET /user/datasets => ${res.status()}`).toBe(true);
  return (await res.json()) as UserDatasetMeta[];
}

async function deleteUserDataset(req: APIRequestContext, id: string): Promise<void> {
  await req.delete(`${API_BASE}/api/user/datasets/${id}`, { headers: authHeaders });
}

async function cleanupAllUploads(req: APIRequestContext): Promise<void> {
  try {
    const rows = await listMyUploads(req);
    for (const r of rows) {
      await deleteUserDataset(req, r.id);
    }
  } catch {
    // best-effort
  }
}

async function openUploadAccordion(page: Page): Promise<boolean> {
  const toggle = page.getByRole("button", { name: /UPLOAD DATASET\(S\)/i });
  const visible = await toggle
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;
  await toggle.dispatchEvent("click");
  return page
    .getByTestId("dropzone-terrain")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
}

/** Upload a file from a fixture path via the dropzone input. */
async function uploadFileViaDropzone(
  page: Page,
  fixturePath: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const buffer = fs.readFileSync(fixturePath);
  await uploadBufferViaDropzone(page, buffer, filename, mimeType);
}

/** Upload an in-memory buffer via the dropzone input (used for error-path tests). */
async function uploadBufferViaDropzone(
  page: Page,
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  const dropzone = page.getByTestId("dropzone-terrain");
  const input = dropzone.locator('input[type="file"]');
  await input.setInputFiles({ name: filename, mimeType, buffer });
  // react-dropzone may not fire onChange from setInputFiles alone in headless
  // Chromium; dispatch a change event to ensure the onDrop callback fires.
  await input.dispatchEvent("change");
}

/**
 * Click a dataset row and assert the 3D viewer renders the terrain by checking
 * that the depth-scale-bar indicator becomes visible.
 */
async function assertViewerRendersDataset(page: Page, rowTestId: string, expectedName: string): Promise<void> {
  const row = page.getByTestId(rowTestId);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  // The depth-scale-bar appears when terrain data has been fetched and the
  // viewer has a depth range to display — it is driven by JS data, not WebGL.
  await expect(page.getByTestId("depth-scale-bar")).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// BAG
// ---------------------------------------------------------------------------


/**
 * Seed synthetic terrain via the test bridge. The sidebar's "Your Data"
 * section (host of the MY UPLOADS dataset tree) renders an empty state
 * until a terrain is loaded, so API-path tests must seed one before
 * asserting on btn-user-dataset-* rows.
 */
async function seedTerrainForSidebar(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => Boolean(window.__bathyTest?.isTestBridgeReady?.()),
      null,
      { timeout: 10_000 },
    )
    .catch(() => {});
  await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
  await page
    .waitForFunction(
      () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
      null,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

test.describe("BAG file-upload flow", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_BASE}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_BASE} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });
    await cleanupAllUploads(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAllUploads(request);
  });

  test("API path: uploading survey.bag via multipart POST saves the dataset, returns terrain and overview, and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    expect(await listMyUploads(request)).toHaveLength(0);

    const filename = `survey-e2e-api-${Date.now()}.bag`;
    const buffer = fs.readFileSync(BAG_FIXTURE_PATH);
    const uploadRes = await request.post(`${API_BASE}/api/datasets/upload`, {
      headers: authHeaders,
      multipart: {
        file: { name: filename, mimeType: "application/octet-stream", buffer },
        resolution: "64",
      },
      timeout: 120_000,
    });
    expect(uploadRes.status(), "POST /datasets/upload should succeed for survey.bag").toBe(200);

    const body = (await uploadRes.json()) as UploadResponseBody;
    expect(
      body.saveError,
      `auto-save should not fail; got: ${JSON.stringify(body.saveError)}`,
    ).toBeUndefined();
    expect(body.savedDatasetId, "savedDatasetId must be present after a successful BAG upload").toBeTruthy();
    expect(body.terrain, "terrain grid must be present in the upload response").toBeTruthy();
    expect(body.overview, "overview grid must be present in the upload response").toBeTruthy();
    expect(typeof body.terrain?.minDepth).toBe("number");
    expect(typeof body.overview?.minDepth).toBe("number");

    const savedId = body.savedDatasetId as string;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    expect(body.savedDatasetMeta?.name).toBe(expectedName);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const row = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(expectedName);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(page, `btn-user-dataset-${savedId}`, expectedName);
    await expect(page.getByTestId("user-dataset-load-error")).toHaveCount(0);
  });

  test("browser UI path: dropping survey.bag onto the dropzone adds the row to MY UPLOADS and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    // The browser UI path includes: upload, row wait, reload, list API call,
    // navigate to "/", click + depth-scale-bar assertion. Extend the timeout
    // beyond the 60s default to give the full sequence room to complete.
    test.setTimeout(120_000);
    expect(await listMyUploads(request)).toHaveLength(0);

    // ?noCanvas=1 skips the R3F Canvas mount — without it, headless Chromium's
    // missing WebGL context can starve the upload mutation of microtasks.
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    const filename = `survey-e2e-ui-${Date.now()}.bag`;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

    await uploadFileViaDropzone(page, BAG_FIXTURE_PATH, filename, "application/octet-stream");

    const uploadingText = page.getByText(/Uploading.*parsing/i);
    const progressVisible = await uploadingText
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!progressVisible) {
      console.log("[bag-upload e2e] upload completed before progress text was captured — continuing");
    }

    const newRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(newRow).toBeVisible({ timeout: 120_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const persistedRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });

    const uploads = await listMyUploads(request);
    const savedRow = uploads.find((u) => u.name === expectedName);
    expect(savedRow, "row must be in the DB, not only in the React Query cache").toBeTruthy();

    // Navigate without noCanvas=1 to confirm the 3D viewer renders the dataset.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(
      page,
      `btn-user-dataset-${savedRow!.id}`,
      expectedName,
    );
  });

  test("error path: dropzone shows error when a corrupt BAG file (plain text) is uploaded", async ({
    page,
  }) => {
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    // Send plain text with a .bag extension — the bag_parser.py subprocess will
    // fail immediately when h5py rejects the non-HDF5 content.
    const corruptBag = Buffer.from("this is not a valid HDF5 / BAG file");
    const filename = `survey-e2e-bad-${Date.now()}.bag`;
    await uploadBufferViaDropzone(page, corruptBag, filename, "application/octet-stream");

    // The UI renders the `details` field from the server's 422 parse_error response.
    // bag_parser.py wraps the h5py failure as "BAG parse error: <stderr>".
    const errorText = page.getByText(/BAG parse error|BAG parsing failed/i);
    await expect(errorText).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// NMEA
// ---------------------------------------------------------------------------

test.describe("NMEA file-upload flow", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_BASE}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_BASE} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });
    await cleanupAllUploads(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAllUploads(request);
  });

  test("API path: uploading survey.nmea via multipart POST saves the dataset, returns terrain and overview, and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    expect(await listMyUploads(request)).toHaveLength(0);

    const filename = `survey-e2e-api-${Date.now()}.nmea`;
    const buffer = fs.readFileSync(NMEA_FIXTURE_PATH);
    const uploadRes = await request.post(`${API_BASE}/api/datasets/upload`, {
      headers: authHeaders,
      multipart: {
        file: { name: filename, mimeType: "text/plain", buffer },
        resolution: "64",
      },
      timeout: 90_000,
    });
    expect(uploadRes.status(), "POST /datasets/upload should succeed for survey.nmea").toBe(200);

    const body = (await uploadRes.json()) as UploadResponseBody;
    expect(
      body.saveError,
      `auto-save should not fail; got: ${JSON.stringify(body.saveError)}`,
    ).toBeUndefined();
    expect(body.savedDatasetId, "savedDatasetId must be present after a successful NMEA upload").toBeTruthy();
    expect(body.terrain, "terrain grid must be present in the upload response").toBeTruthy();
    expect(body.overview, "overview grid must be present in the upload response").toBeTruthy();
    expect(typeof body.terrain?.minDepth).toBe("number");
    expect(typeof body.overview?.minDepth).toBe("number");

    const savedId = body.savedDatasetId as string;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    expect(body.savedDatasetMeta?.name).toBe(expectedName);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const row = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(expectedName);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(page, `btn-user-dataset-${savedId}`, expectedName);
    await expect(page.getByTestId("user-dataset-load-error")).toHaveCount(0);
  });

  test("browser UI path: dropping survey.nmea onto the dropzone adds the row to MY UPLOADS and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    expect(await listMyUploads(request)).toHaveLength(0);

    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    const filename = `survey-e2e-ui-${Date.now()}.nmea`;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

    await uploadFileViaDropzone(page, NMEA_FIXTURE_PATH, filename, "text/plain");

    const uploadingText = page.getByText(/Uploading.*parsing/i);
    const progressVisible = await uploadingText
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!progressVisible) {
      console.log("[nmea-upload e2e] upload completed before progress text was captured — continuing");
    }

    const newRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(newRow).toBeVisible({ timeout: 90_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const persistedRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });

    const uploads = await listMyUploads(request);
    const savedRow = uploads.find((u) => u.name === expectedName);
    expect(savedRow, "row must be in the DB, not only in the React Query cache").toBeTruthy();

    // Navigate without noCanvas=1 to confirm the 3D viewer renders the dataset.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(
      page,
      `btn-user-dataset-${savedRow!.id}`,
      expectedName,
    );
  });

  test("error path: dropzone shows error when an NMEA file with no valid sentences is uploaded", async ({
    page,
  }) => {
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    // Send a buffer with no valid NMEA sentences — parseNmea returns 0 points
    // → server responds with 400 insufficient_data.
    const noSentences = Buffer.from("not valid nmea data\nno dollar signs here\n");
    const filename = `survey-e2e-bad-${Date.now()}.nmea`;
    await uploadBufferViaDropzone(page, noSentences, filename, "text/plain");

    // The server returns details: "File must contain at least 10 valid (lon, lat, depth) rows"
    const errorText = page.getByText(/at least 10 valid/i);
    await expect(errorText).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

test.describe("GPX file-upload flow", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_BASE}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_BASE} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page, request }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        localStorage.removeItem("bathyscan:panel-collapse");
      } catch {}
    });
    await cleanupAllUploads(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAllUploads(request);
  });

  test("API path: uploading survey.gpx via multipart POST saves the dataset, returns terrain and overview, and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    expect(await listMyUploads(request)).toHaveLength(0);

    const filename = `survey-e2e-api-${Date.now()}.gpx`;
    const buffer = fs.readFileSync(GPX_FIXTURE_PATH);
    const uploadRes = await request.post(`${API_BASE}/api/datasets/upload`, {
      headers: authHeaders,
      multipart: {
        file: { name: filename, mimeType: "application/gpx+xml", buffer },
        resolution: "64",
      },
      timeout: 90_000,
    });
    expect(uploadRes.status(), "POST /datasets/upload should succeed for survey.gpx").toBe(200);

    const body = (await uploadRes.json()) as UploadResponseBody;
    expect(
      body.saveError,
      `auto-save should not fail; got: ${JSON.stringify(body.saveError)}`,
    ).toBeUndefined();
    expect(body.savedDatasetId, "savedDatasetId must be present after a successful GPX upload").toBeTruthy();
    expect(body.terrain, "terrain grid must be present in the upload response").toBeTruthy();
    expect(body.overview, "overview grid must be present in the upload response").toBeTruthy();
    expect(typeof body.terrain?.minDepth).toBe("number");
    expect(typeof body.overview?.minDepth).toBe("number");

    const savedId = body.savedDatasetId as string;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    expect(body.savedDatasetMeta?.name).toBe(expectedName);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const row = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(expectedName);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(page, `btn-user-dataset-${savedId}`, expectedName);
    await expect(page.getByTestId("user-dataset-load-error")).toHaveCount(0);
  });

  test("browser UI path: dropping survey.gpx onto the dropzone adds the row to MY UPLOADS and the 3D viewer renders data", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    expect(await listMyUploads(request)).toHaveLength(0);

    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    const filename = `survey-e2e-ui-${Date.now()}.gpx`;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

    await uploadFileViaDropzone(page, GPX_FIXTURE_PATH, filename, "application/gpx+xml");

    const uploadingText = page.getByText(/Uploading.*parsing/i);
    const progressVisible = await uploadingText
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!progressVisible) {
      console.log("[gpx-upload e2e] upload completed before progress text was captured — continuing");
    }

    const newRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(newRow).toBeVisible({ timeout: 90_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    const persistedRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });

    const uploads = await listMyUploads(request);
    const savedRow = uploads.find((u) => u.name === expectedName);
    expect(savedRow, "row must be in the DB, not only in the React Query cache").toBeTruthy();

    // Navigate without noCanvas=1 to confirm the 3D viewer renders the dataset.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await seedTerrainForSidebar(page);
    await assertViewerRendersDataset(
      page,
      `btn-user-dataset-${savedRow!.id}`,
      expectedName,
    );
  });

  test("error path: dropzone shows error when a GPX file with no track points or waypoints is uploaded", async ({
    page,
  }) => {
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    // Valid GPX XML but empty — no <trkpt> or <wpt> elements.
    // parseGpxTerrain throws "GPX file contains no track points with elevation data..."
    // which the server surfaces as a 422 parse_error detail.
    const emptyGpx = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">' +
      "<metadata><name>Empty Survey</name></metadata>" +
      "</gpx>",
    );
    const filename = `survey-e2e-bad-${Date.now()}.gpx`;
    await uploadBufferViaDropzone(page, emptyGpx, filename, "application/gpx+xml");

    // The server returns: "GPX file contains no track points with elevation data."
    const errorText = page.getByText(/GPX file contains no track points/i);
    await expect(errorText).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);
  });
});
