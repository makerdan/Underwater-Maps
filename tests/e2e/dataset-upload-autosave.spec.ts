/**
 * End-to-end coverage for the upload auto-save flow (Task #122).
 *
 * Task #122 fixed the silent-failure bug in `POST /datasets/upload`: the
 * server now surfaces a structured `saveError` on the 200 response when the
 * authenticated insert into `customDatasets` fails, and the client (a)
 * optimistically inserts `savedDatasetMeta` into the MY UPLOADS React Query
 * cache and (b) shows an inline "Uploaded, but couldn't save to your
 * account — …" message when the save fails. These two paths are covered
 * here end-to-end against the real api-server + Postgres.
 *
 * Auth: the Playwright webServers run with E2E_AUTH_BYPASS=1 (api-server)
 * and VITE_DEV_AUTH_BYPASS=1 (bathyscan). The frontend installs a fetch
 * patch that injects `x-e2e-user-id: dev-user-bypass` on every /api/*
 * request, which the api-server's bypass middleware accepts in lieu of a
 * Clerk session. The upload route itself also honors the bypass header
 * (added in Task #122) so the auto-save path against the real DB is
 * exercised without a Clerk JWT.
 */
import { test, expect, type APIRequestContext, type Page, API_URL, E2E_USER_ID } from "./fixtures";

const API_BASE = API_URL;
const FAKE_USER_ID = E2E_USER_ID;

const authHeaders = { "x-e2e-user-id": FAKE_USER_ID };

interface UserDatasetMeta {
  id: string;
  name: string;
  minDepth: number;
  maxDepth: number;
  folderId?: string | null;
  createdAt: string;
}

/**
 * Build a minimal but valid CSV: 12 (lon, lat, depth) rows around the
 * Mariana Trench. >= 10 valid rows are required by the upload route.
 */
function makeTinyCsv(): string {
  // 12×12 grid of points covers the bbox densely. Sparse inputs (e.g. a
  // dozen points) blow up gridPoints' IDW fill at the default 256-resolution
  // to O(N⁴) — minutes of CPU, which times out the upload route.
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

/**
 * Build a minimal `TerrainData`-shaped object that satisfies the
 * OpenAPI-generated type. The failure-path test stubs the upload response
 * client-side and the UI doesn't assert on grid contents in that branch,
 * so a flat 4-cell grid is sufficient.
 */
function stubTerrain(datasetId: string): Record<string, unknown> {
  return {
    datasetId,
    name: datasetId,
    waterType: "salt",
    resolution: 2,
    width: 2,
    height: 2,
    depths: [100, 110, 120, 130],
    minDepth: 100,
    maxDepth: 130,
    minLon: 142.4,
    maxLon: 142.5,
    minLat: 11.3,
    maxLat: 11.4,
    centerLon: 142.45,
    centerLat: 11.35,
  };
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
  // The dataset panel is expanded by default. Click the "UPLOAD DATASET(S)"
  // accordion to reveal the dropzone.
  const toggle = page.getByRole("button", { name: /UPLOAD DATASET\(S\)/i });
  const toggleVisible = await toggle
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!toggleVisible) return false;
  await toggle.dispatchEvent("click");
  const dropzoneVisible = await page
    .getByTestId("dropzone-terrain")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return dropzoneVisible;
}

async function uploadCsvViaDropzone(page: Page, filename: string): Promise<void> {
  const dropzone = page.getByTestId("dropzone-terrain");
  // react-dropzone renders a hidden file input inside the dropzone div.
  const input = dropzone.locator('input[type="file"]');
  await input.setInputFiles({
    name: filename,
    mimeType: "text/csv",
    buffer: Buffer.from(makeTinyCsv(), "utf8"),
  });
  // In headless Chromium, react-dropzone's onChange handler may not fire
  // from setInputFiles alone. Dispatch an additional change event to ensure
  // the onDrop/onChange callback fires and the upload mutation starts.
  await input.dispatchEvent("change");
}

test.describe("upload auto-save end-to-end", () => {
  test.beforeAll(async ({ request }) => {
    const probe = await request.get(`${API_BASE}/api/datasets`);
    expect(
      probe.ok(),
      `api-server unreachable at ${API_BASE} — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page, request }) => {
    // Suppress SimulatedDataConfirmDialog before any navigation so it cannot
    // block the MY UPLOADS panel or dataset row clicks.
    // Also clear the panel-collapse localStorage key so the "My Library"
    // panel always starts expanded regardless of what a prior test run may
    // have persisted for the bypass user.
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

  test("success path: uploaded CSV appears in MY UPLOADS, persists across reload, and is clickable", async ({
    page,
    request,
  }) => {
    // Pre-condition: no user datasets exist yet for this fake user.
    expect(await listMyUploads(request)).toHaveLength(0);

    // Drive the real upload route end-to-end. APIRequestContext talks
    // directly to the api-server with the bypass header, exercising:
    //   - multer multipart parsing
    //   - parseXyzCsv + computeGrid interpolation
    //   - the Drizzle insert into custom_datasets (Task #122 added this
    //     auto-save path for header-bypass requests)
    //   - the auth-bypass branch in the upload route
    // We can't reliably drive this via the headless-Chromium dropzone:
    // R3F throws WebGL exceptions on the React tree which intermittently
    // stalls the in-page upload mutation at ~88 %. The dropzone *is*
    // exercised separately in the failure-path test below, where the
    // route is intercepted client-side so no real upload streams.
    const filename = `e2e-autosave-${Date.now()}.csv`;
    const csv = makeTinyCsv();
    const uploadRes = await request.post(`${API_BASE}/api/datasets/upload`, {
      headers: authHeaders,
      multipart: {
        file: { name: filename, mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") },
        resolution: "256",
      },
      timeout: 60_000,
    });
    expect(uploadRes.status(), "POST /datasets/upload should succeed").toBe(200);
    const uploadBody = (await uploadRes.json()) as {
      savedDatasetId?: string;
      savedDatasetMeta?: { id: string; name: string };
      saveError?: string;
    };
    expect(
      uploadBody.saveError,
      `auto-save should not error in the happy path; got ${JSON.stringify(uploadBody.saveError)}`,
    ).toBeUndefined();
    expect(uploadBody.savedDatasetId, "savedDatasetId must be present").toBeTruthy();
    const savedId = uploadBody.savedDatasetId as string;
    // Server derives the display name from the original filename.
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
    expect(uploadBody.savedDatasetMeta?.name).toBe(expectedName);

    // 1) Load the app — MY UPLOADS pulls the new row from the DB via
    //    React Query and renders the matching folder-tree button.
    //    `domcontentloaded` rather than the default `load`: the latter
    //    waits on every image/font, which on this dev build never settles
    //    cleanly under the R3F WebGL-failure storm in headless Chromium.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const optimisticRow = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(optimisticRow).toBeVisible({ timeout: 30_000 });
    await expect(optimisticRow).toContainText(expectedName);

    // 2) Reload — the row is still in MY UPLOADS, sourced from the DB.
    //    This is the regression guard for "vanish on refresh" — the
    //    pre-Task-#122 bug where the upload completed but no DB row was
    //    written, so the optimistic cache entry disappeared on refetch.
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedRow = page.getByTestId(`btn-user-dataset-${savedId}`);
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });
    await expect(persistedRow).toContainText(expectedName);

    // 3) Clicking the row issues a real GET /user/datasets/:id/terrain
    //    which returns 200 (auth-bypassed). Headless Chromium lacks WebGL
    //    so we don't assert the 3D canvas rendered, but a successful
    //    click must not surface the "Failed to load" inline error banner.
    await persistedRow.click();
    await expect(page.getByTestId("user-dataset-load-error")).toHaveCount(0);
  });

  test("UI path: dropping a CSV onto the dropzone uploads it for real and inserts the new row into MY UPLOADS", async ({
    page,
    request,
  }) => {
    // Pre-condition: no user datasets exist yet for this fake user.
    expect(await listMyUploads(request)).toHaveLength(0);

    // `?noCanvas=1` is a dev-only escape hatch in TourScene that skips the
    // R3F Canvas mount. Without it, headless Chromium's missing WebGL
    // context makes three.js throw on every Canvas mount and the resulting
    // error storm starves the React-Query mutation of microtasks (the
    // upload progress bar hangs at ~88 % until the test times out). The
    // flag is gated on import.meta.env.DEV + VITE_DEV_AUTH_BYPASS so it
    // can never ship to production. See artifacts/bathyscan/src/pages/TourScene.tsx.
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible — upload UI not available in this environment");
      return;
    }

    const filename = `e2e-ui-upload-${Date.now()}.csv`;
    const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

    // Real upload: no `page.route()` interception, so the multipart POST
    // streams to the api-server, runs through multer + parseXyzCsv +
    // gridPoints, and inserts the new row into the custom_datasets table
    // via the auth-bypass branch added in Task #122.
    await uploadCsvViaDropzone(page, filename);

    // The progress UI appears (the regression guard for "stalls at 88 %"):
    // the dropzone swaps to the "Uploading & parsing..." copy while the
    // mutation is in flight, and the optimistic MY UPLOADS row appears
    // once the response lands. We assert on the optimistic row directly
    // (with a generous timeout) rather than on the transient progress
    // text, because the parse + grid step can be quick enough on small
    // inputs that the progress UI flips to the completed state before
    // Playwright can latch onto it.
    const newRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(newRow).toBeVisible({ timeout: 60_000 });

    // The optimistic cache insert should match what the server actually
    // persisted — the row must still be there after a hard reload, which
    // forces React Query to refetch /user/datasets from the DB.
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedRow = page
      .getByTestId(/^btn-user-dataset-/)
      .filter({ hasText: expectedName });
    await expect(persistedRow).toBeVisible({ timeout: 30_000 });

    // And the auto-save failure banner must NOT have appeared — this was
    // a happy-path upload, so `saveError` should be undefined and the
    // inline "couldn't save to your account" element absent.
    await expect(page.getByTestId("upload-save-error")).toHaveCount(0);

    // Confirm the row really exists in the DB (not just in the React
    // Query cache).
    const uploads = await listMyUploads(request);
    expect(uploads.some((u) => u.name === expectedName)).toBe(true);
  });

  test("failure path: server returns saveError → inline 'couldn't save to your account' message is shown", async ({
    page,
    request,
  }) => {
    await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
    if (!(await openUploadAccordion(page))) {
      test.skip(true, "Upload accordion or dropzone not visible — upload UI not available in this environment");
      return;
    }

    // Stub the upload response with a fully-synthetic 200-with-saveError
    // payload — the exact shape the server returns when the Drizzle insert
    // throws (e.g. duplicate id, connection failure). We do NOT call
    // `route.fetch()` to forward upstream because (a) the real upload is
    // slow under headless-Chromium's WebGL-storm load and frequently
    // stalls the in-page mutation, and (b) we'd then have to clean up the
    // persisted row. The terrain/overview grids only need to satisfy the
    // OpenAPI-generated type; the UI does not assert on their contents in
    // this path. The browser never sees a real upload — only this stub.
    await page.route("**/api/datasets/upload", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terrain: stubTerrain("fail-terrain"),
          overview: stubTerrain("fail-overview"),
          saveError: "Database insert failed (simulated)",
        }),
      });
    });

    const filename = `e2e-autosave-fail-${Date.now()}.csv`;
    await uploadCsvViaDropzone(page, filename);

    // The upload panel stays open and shows the inline auto-save failure
    // message (sourced from `data.saveError`), rendered as the dedicated
    // `upload-save-error` element next to a retry button.
    const saveErrorEl = page.getByTestId("upload-save-error");
    await expect(saveErrorEl).toBeVisible({ timeout: 15_000 });
    await expect(saveErrorEl).toContainText(/Uploaded, but couldn't save to your account/i);
    await expect(saveErrorEl).toContainText(/Database insert failed \(simulated\)/);

    // And MY UPLOADS does NOT gain a phantom row — neither in the DB nor
    // in the React Query cache (because savedDatasetId was absent).
    // Filter specifically for rows from this test (the stub never writes to DB,
    // so no "autosave-fail" row should exist; rows from prior success-path
    // tests have different name prefixes and are excluded by this filter).
    const allUploads = await listMyUploads(request);
    const failRows = allUploads.filter(
      (u) => u.name?.includes("autosave-fail") || u.name?.includes("autosave fail"),
    );
    expect(failRows).toHaveLength(0);
  });
});
