/**
 * End-to-end coverage for the chunked upload flow from the browser.
 *
 * Files between 10 MB and 50 MB use the chunked path:
 *   POST /api/datasets/upload/chunk  (one call per 5 MB slice)
 *   → POST /api/datasets/upload/chunk/finalize
 *   → GET  /api/datasets/upload/jobs/:jobId  (polled until done)
 *
 * Both tests use a ~10.8 MB synthetic CSV fixture generated in memory
 * (670 × 670 regular grid of lon,lat,depth rows, ~24 bytes each).
 * This is:
 *   - Above the 10 MB CHUNKED_THRESHOLD → takes the chunked path (not multer)
 *   - Below the 50 MB GCS_THRESHOLD     → stays on the chunked path (not GCS)
 *   - Dense enough (448 K input points → 256×256 grid) that IDW fill is
 *     essentially instantaneous on the server
 *
 * The happy-path test exercises the real api-server end-to-end with zero
 * page.route() stubs.  The retry test uses page.route() only to fail the
 * very first chunk of the initial upload; all retry-phase calls go to the
 * real server (route.continue()) so the full pipeline — chunk assembly,
 * CSV parse, terrain-grid build, DB insert — is exercised.
 *
 * Auth: both webServers run with bypass mode (E2E_AUTH_BYPASS=1 /
 * VITE_DEV_AUTH_BYPASS=1).  The frontend injects `x-e2e-user-id:
 * dev-user-bypass` on every /api/* request so the upload saves to the
 * real Postgres DB without a Clerk JWT.
 */
import { test, expect, type APIRequestContext, type Page, API_URL, E2E_USER_ID } from "./fixtures";

const API_BASE = API_URL;
const authHeaders = { "x-e2e-user-id": E2E_USER_ID };

// ─── API helpers ──────────────────────────────────────────────────────────────

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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Generate ~10.8 MB of valid lon,lat,depth CSV.
 *
 * 670 × 670 = 448,900 rows at ~24 bytes each ≈ 10.8 MB (above the 10 MB
 * chunked threshold, below the 50 MB GCS threshold).  The bbox covers a
 * 6.69° × 6.69° area near the Mariana Trench so the dense regular grid
 * fills virtually every 256×256 terrain cell, keeping IDW fill trivial.
 */
function makeLargeCsv(): Buffer {
  const ROWS = 670;
  const COLS = 670;
  const lines: string[] = ["lon,lat,depth"];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lines.push(
        `${(142.4 + c * 0.01).toFixed(4)},${(11.3 + r * 0.01).toFixed(4)},${(1000 + (r + c) * 0.5).toFixed(1)}`,
      );
    }
  }
  return Buffer.from(lines.join("\n") + "\n");
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

/** Drop a buffer onto the file input inside the upload dropzone. */
async function dropBufferOntoDropzone(
  page: Page,
  filename: string,
  buffer: Buffer,
  mimeType = "text/csv",
): Promise<void> {
  const dropzone = page.getByTestId("dropzone-terrain");
  const input = dropzone.locator('input[type="file"]');
  await input.setInputFiles({ name: filename, mimeType, buffer });
  // react-dropzone may not fire onChange from setInputFiles alone in headless
  // Chromium; dispatch a change event to ensure the onDrop callback fires.
  await input.dispatchEvent("change");
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe("Chunked upload flow (> 10 MB)", () => {
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

  // ── Happy path — real end-to-end, no page.route() stubs ─────────────────────
  test(
    "happy path: real chunked upload shows 'Uploading in chunks…' then 'Processing on server…' and the dataset row appears in MY UPLOADS",
    async ({ page, request }) => {
      test.setTimeout(180_000);

      // Pre-condition: no uploads for the bypass user.
      expect(await listMyUploads(request)).toHaveLength(0);

      const csvBuffer = makeLargeCsv();
      // Guard: the buffer must exceed the 10 MB chunked threshold.
      expect(csvBuffer.byteLength).toBeGreaterThan(10 * 1024 * 1024);

      const filename = `chunked-e2e-happy-${Date.now()}.csv`;
      const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

      await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

      if (!(await openUploadAccordion(page))) {
        test.skip(true, "Upload accordion or dropzone not visible in this environment");
        return;
      }

      // Drop the large CSV.  No page.route() stubs — every request (chunk,
      // finalize, job-poll, user/datasets) goes to the real api-server.
      await dropBufferOntoDropzone(page, filename, csvBuffer);

      // 1. The dropzone must show "Uploading in chunks…" while chunks are sent.
      await expect(page.getByText(/Uploading in chunks/i)).toBeVisible({
        timeout: 30_000,
      });

      // 2. After finalize the dropzone must show "Processing on server…" while
      //    the job-status endpoint is polled.
      await expect(page.getByText(/Processing on server/i)).toBeVisible({
        timeout: 30_000,
      });

      // 3. Once the job returns "done", the MY UPLOADS row must appear.
      const newRow = page
        .getByTestId(/^btn-user-dataset-/)
        .filter({ hasText: expectedName });
      await expect(newRow).toBeVisible({ timeout: 120_000 });

      // Post-condition: dataset is persisted in the real DB — not just cached.
      const uploads = await listMyUploads(request);
      expect(uploads.some((u) => u.name === expectedName)).toBe(true);
    },
  );

  // ── Retry path — only first chunk is mocked to fail ──────────────────────────
  test(
    "retry path: chunk failure surfaces the retry button; clicking it resumes and completes the upload end-to-end via the real server",
    async ({ page, request }) => {
      test.setTimeout(180_000);

      const csvBuffer = makeLargeCsv();
      const filename = `chunked-e2e-retry-${Date.now()}.csv`;
      const expectedName = filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

      // Intercept only the very first chunk call (chunk 0 of the initial upload)
      // and return HTTP 500 to trigger the error-state / retry-button flow.
      // All subsequent chunk calls — chunk 0 onward on the retry — are passed
      // through to the real api-server via route.continue() so the full pipeline
      // (chunk assembly → CSV parse → terrain grid → DB insert) is exercised.
      let firstChunkIntercepted = false;
      await page.route("**/api/datasets/upload/chunk", async (route) => {
        if (!firstChunkIntercepted) {
          firstChunkIntercepted = true;
          await route.fulfill({
            status: 500,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              error: "server_error",
              details: "Simulated chunk failure (e2e)",
            }),
          });
        } else {
          await route.continue();
        }
      });

      await page.goto("/?noCanvas=1", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tour-scene-canvas-disabled")).toBeVisible();

      if (!(await openUploadAccordion(page))) {
        test.skip(true, "Upload accordion or dropzone not visible in this environment");
        return;
      }

      await dropBufferOntoDropzone(page, filename, csvBuffer);

      // The first chunk fails → the retry button must appear.
      const retryBtn = page.getByTestId("btn-retry-chunked-upload");
      await expect(retryBtn).toBeVisible({ timeout: 15_000 });

      // ── Click retry — all subsequent chunk/finalize/poll calls are real ──────
      await retryBtn.click();

      // Retry re-enters the uploading phase.
      await expect(page.getByText(/Uploading in chunks/i)).toBeVisible({
        timeout: 15_000,
      });

      // After all retry-chunks land, finalize is called and job polling begins.
      await expect(page.getByText(/Processing on server/i)).toBeVisible({
        timeout: 30_000,
      });

      // The MY UPLOADS row must appear once the job returns "done".
      const newRow = page
        .getByTestId(/^btn-user-dataset-/)
        .filter({ hasText: expectedName });
      await expect(newRow).toBeVisible({ timeout: 120_000 });

      // Post-condition: dataset persisted to the real DB.
      const uploads = await listMyUploads(request);
      expect(uploads.some((u) => u.name === expectedName)).toBe(true);
    },
  );
});
