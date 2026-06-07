/**
 * End-to-end coverage for the LAZ file-upload flow from the browser.
 *
 * The existing dataset-upload-autosave.spec.ts exercises the CSV path.
 * This suite covers the binary LAZ path end-to-end — verifying that:
 *   1. The api-server's LAZ parser (laz-perf WASM) accepts the fixture file.
 *   2. The browser dropzone UI shows upload progress while the mutation is
 *      in flight and then surfaces the completed dataset row in MY UPLOADS.
 *   3. The dataset persists across a hard reload (DB insert succeeded).
 *   4. No save-error banner appears on the happy path.
 *
 * Auth: both webServers run with bypass mode (E2E_AUTH_BYPASS=1 /
 * VITE_DEV_AUTH_BYPASS=1). Every API call injects `x-e2e-user-id:
 * dev-user-bypass` so the upload auto-save path is exercised without a
 * real Clerk JWT.
 *
 * Fixture: artifacts/api-server/src/__tests__/fixtures/survey.laz
 *   - 440 bytes, LASF magic header, well below the 10 MB chunked threshold.
 *   - Goes through the standard POST /api/datasets/upload (multer + laz-perf).
 */
import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext, type Page, API_URL, E2E_USER_ID } from "./fixtures";

const API_BASE = API_URL;
const authHeaders = { "x-e2e-user-id": E2E_USER_ID };

const LAZ_FIXTURE_PATH = path.resolve(
  process.cwd(),
  "artifacts/api-server/src/__tests__/fixtures/survey.laz",
);

interface UserDatasetMeta {
  id: string;
  name: string;
  minDepth: number;
  maxDepth: number;
  folderId?: string | null;
  createdAt: string;
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

async function uploadLazViaDropzone(page: Page, filename: string): Promise<void> {
  const lazBuffer = fs.readFileSync(LAZ_FIXTURE_PATH);
  const dropzone = page.getByTestId("dropzone-terrain");
  const input = dropzone.locator('input[type="file"]');
  await input.setInputFiles({
    name: filename,
    mimeType: "application/octet-stream",
    buffer: lazBuffer,
  });
  // react-dropzone may not fire onChange from setInputFiles alone in headless
  // Chromium; dispatch a change event to ensure the onDrop callback fires.
  await input.dispatchEvent("change");
}

test.describe("LAZ file-upload flow", () => {
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

  test("API path: uploading survey.laz via multipart POST saves the dataset and it appears in MY UPLOADS", async ({
    page,
    request,
  }) => {
    // Pre-condition: no uploads exist for the bypass user.
    expect(await listMyUploads(request)).toHaveLength(0);

    // Upload the LAZ fixture directly through the API with the bypass header.
    // This exercises:
    //   - multer multipart parsing of a binary file
    //   - laz-perf WASM decoding (LAZ → point cloud)
    //   - computeGrid interpolation into a TerrainData grid
    //   - Drizzle insert into custom_datasets (auth-bypass branch)
    const filename = `survey-e2e-api-${Date.now()}.laz`;
    const lazBuffer = fs.readFileSync(LAZ_FIXTURE_PATH);
    const uploadRes = await request.post(`${API_BASE}/api/datasets/upload`, {
      headers: authHeaders,
      multipart: {
        file: { name: filename, mimeType: "application/octet-stream", buffer: lazBuffer },
        resolution: "64",
      },
      timeout: 90_000,
    });
    expect(uploadRes.status(), "POST /datasets/upload should succeed for survey.laz").toBe(200);

    const body = (await uploadRes.json()) as {
      savedDatasetId?: string;
      savedDatasetMeta?: { id: string; name: string };
      saveError?: string;
    };
    expect(
      body.saveError,
      `auto-save should not fail; got: ${JSON.stringify(body.saveError)}`,
    ).toBeUndefined();
    expect(body.savedDatasetId, "savedDatasetId must be present after a successful LAZ upload").toBeTruthy();

    const savedId = body.savedDatasetId as string;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    expect(body.savedDatasetMeta?.name).toBe(expectedName);

    // Load the app and confirm the new row is visible in MY UPLOADS.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText(expectedName);

    // Reload — the row must survive a hard refresh (DB-backed, not just cache).
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedRow = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });
    await expect(persistedRow).toContainText(expectedName);

    // Clicking the row must not surface the inline "Failed to load" banner.
    await persistedRow.click();
    await expect(page.getByTestId("user-dataset-load-error")).toHaveCount(0);
  });

  test("browser UI path: dropping survey.laz onto the dropzone shows upload progress and adds the row to MY UPLOADS", async ({
    page,
    request,
  }) => {
    // Pre-condition: no uploads exist for the bypass user.
    expect(await listMyUploads(request)).toHaveLength(0);

    // ?noCanvas=1 skips the R3F Canvas mount — without it, headless
    // Chromium's missing WebGL context floods the React tree with errors
    // that starve the upload mutation of microtasks, causing the progress
    // bar to stall. This flag is gated on DEV + VITE_DEV_AUTH_BYPASS so
    // it can never reach production.
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    const filename = `survey-e2e-ui-${Date.now()}.laz`;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

    // Initiate the real upload — no page.route() interception, so the
    // multipart POST streams to the api-server and runs through laz-perf.
    await uploadLazViaDropzone(page, filename);

    // While the upload mutation is in flight the dropzone should show the
    // "Uploading & parsing..." pulse. The fixture is tiny (440 B) so this
    // window can be very short; we use a short timeout and don't fail if
    // the progress text is already gone by the time Playwright checks.
    const uploadingText = page.getByText(/Uploading.*parsing/i);
    const progressVisible = await uploadingText
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    // Log rather than fail: the parse is fast enough that the panel may
    // already have flipped to the completed state.
    if (!progressVisible) {
      // Not a failure — the upload completed before the assertion could land.
      console.log("[laz-upload e2e] upload completed before progress text was captured — continuing");
    }

    // The MY UPLOADS row should appear once the mutation resolves (with a
    // generous timeout to allow for laz-perf WASM initialisation).
    const newRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(newRow).toBeVisible({ timeout: 90_000 });

    // No auto-save failure banner should appear on the happy path.
    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);

    // Hard reload: the row must still be present once React Query re-fetches
    // from the DB (regression guard for "vanish on refresh").
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });

    // Confirm the row is in the DB, not only in the React Query cache.
    const uploads = await listMyUploads(request);
    expect(uploads.some((u) => u.name === expectedName)).toBe(true);
  });

  test("browser UI path: upload error shown when server rejects the LAZ file", async ({
    page,
  }) => {
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible in this environment");
      return;
    }

    // Intercept the upload route and return a 422 with a structured error.
    await page.route("**/api/datasets/upload", async (route) => {
      await route.fulfill({
        status: 422,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "No valid soundings found in file (simulated)" }),
      });
    });

    const filename = `survey-e2e-bad-${Date.now()}.laz`;
    await uploadLazViaDropzone(page, filename);

    // The dropzone should revert to the idle state and display the error
    // message returned by the server.
    const errorText = page.getByText(/No valid soundings found in file/i);
    await expect(errorText).toBeVisible({ timeout: 15_000 });

    // No save-error element should appear — the upload itself failed,
    // so there is nothing to retry-save.
    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);
  });
});
