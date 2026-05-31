/**
 * E2E tests for the bathymetric data download flow.
 *
 * Covers:
 *   - API auth-gating: unauthenticated requests to /terrain/download/info and
 *     /terrain/download return 401.
 *   - API preflight: authenticated /terrain/download/info returns the expected
 *     shape for a valid bbox.
 *   - UI: the ↓ DOWNLOAD toggle activates download mode (aria-pressed=true).
 *   - UI: drawing a bbox in download mode renders the TerrainDownloadPopover.
 *   - UI: the popover structure (header, resolution picker, confirm button) is
 *     correct and the download button is enabled for an authenticated user.
 *   - UI: clicking ↓ Download triggers a real file download (CSV attachment).
 *
 * Auth notes
 * ----------
 * The E2E environment runs with VITE_DEV_AUTH_BYPASS=1 (bathyscan) and
 * E2E_AUTH_BYPASS=1 (api-server). The frontend patch injects the header
 * `x-e2e-user-id: dev-user-bypass` on every /api/* request, which the
 * api-server's bypass middleware accepts in lieu of a Clerk JWT.  This means
 * `isSignedIn` is always `true` inside the running app by default.
 *
 * Unauthenticated state is tested two ways:
 *   1. API level: the API-level tests call /terrain/download/info and
 *      /terrain/download without the bypass header and assert 401, confirming
 *      the server-side enforcement gate is intact.
 *   2. Browser level: the "unauthenticated user sees auth-gate warning" UI
 *      test calls `window.__bathyTest.setSimulateSignedOut(true)` before
 *      drawing the bbox.  This flips the dev-bypass `useAuth()` hook to
 *      return `isSignedIn: false`, causing the TerrainDownloadPopover to
 *      render its "Sign in to download…" warning and disable the confirm
 *      button — exercising the same React branch that real signed-out users
 *      would hit.  The flag is always reset in a try/finally block so
 *      subsequent tests are unaffected.
 */

import { test, expect, API_URL, E2E_USER_ID } from "./fixtures";
import { overviewMapCanvas } from "./_helpers/canvases";

const OVERLAY_HEADER = ".overview-map-header";

const AUTH_HEADERS = { "x-e2e-user-id": E2E_USER_ID };

// A small but valid ocean bbox (near Hawaii, clearly water-only).
const BBOX = { north: 21.5, south: 21.0, east: -157.5, west: -158.0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureSignedInOrSkip(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — user is not signed in");
    return false;
  }
  return true;
}

async function openOverview(
  page: import("@playwright/test").Page,
): Promise<void> {
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

  await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });
}

/**
 * Activates the ↓ DOWNLOAD mode toggle (the yellow button in the overview
 * toolbar) and verifies aria-pressed flips to "true".
 */
async function activateDownloadMode(
  page: import("@playwright/test").Page,
): Promise<void> {
  const toggle = page.getByTestId("overview-download-toggle");
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.dispatchEvent("click");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
}

/**
 * Drags a rubber-band rectangle across the overview canvas (centre 30–70 %).
 * In download mode this commits a download bbox and renders
 * TerrainDownloadPopover.
 */
async function drawDownloadBbox(
  page: import("@playwright/test").Page,
): Promise<void> {
  const canvas = overviewMapCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Overview canvas not found");

  const x0 = box.x + box.width * 0.3;
  const y0 = box.y + box.height * 0.3;
  const x1 = box.x + box.width * 0.7;
  const y1 = box.y + box.height * 0.7;

  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
}

// ---------------------------------------------------------------------------
// API-level auth-gate tests (no browser needed)
// ---------------------------------------------------------------------------

test.describe("BathyScan — Terrain Download API auth gate", () => {
  const infoUrl =
    `${API_URL}/api/terrain/download/info` +
    `?north=${BBOX.north}&south=${BBOX.south}&east=${BBOX.east}&west=${BBOX.west}&resolution=64`;

  const downloadUrl =
    `${API_URL}/api/terrain/download` +
    `?north=${BBOX.north}&south=${BBOX.south}&east=${BBOX.east}&west=${BBOX.west}&resolution=64`;

  test("GET /terrain/download/info without auth → 401", async ({ request }) => {
    const resp = await request.get(infoUrl);
    expect(resp.status()).toBe(401);
  });

  test("GET /terrain/download without auth → 401", async ({ request }) => {
    const resp = await request.get(downloadUrl);
    expect(resp.status()).toBe(401);
  });

  test("GET /terrain/download/info with auth → 200 with expected shape", async ({
    request,
  }) => {
    const resp = await request.get(infoUrl, { headers: AUTH_HEADERS });
    // Upstream bathymetry services may be unavailable in the test environment;
    // accept both a successful 200 and a 502 upstream error (but never a 401/403
    // auth failure, which is what we're guarding against).
    const status = resp.status();
    expect([200, 502]).toContain(status);

    if (status === 200) {
      const body = await resp.json() as Record<string, unknown>;
      expect(typeof body["sourceName"]).toBe("string");
      expect(typeof body["dataSource"]).toBe("string");
      expect(typeof body["nominalResolutionM"]).toBe("number");
      expect(typeof body["estimatedPoints"]).toBe("number");
    }
  });

  test("GET /terrain/download with auth → 200 CSV or 502 upstream error, never 401", async ({
    request,
  }) => {
    const resp = await request.get(downloadUrl, { headers: AUTH_HEADERS });
    const status = resp.status();
    // Auth is satisfied — we may get a 200 CSV or a 502 upstream failure, but
    // never a 401/403 auth rejection.
    expect(status).not.toBe(401);
    expect(status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// UI tests — download toolbar mode
// ---------------------------------------------------------------------------

test.describe("BathyScan — Download toolbar mode (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);
  });

  test("↓ DOWNLOAD toggle activates download mode", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);

    const toggle = page.getByTestId("overview-download-toggle");
    await expect(toggle).toBeVisible({ timeout: 5_000 });

    // Initially not pressed.
    const initialPressed = await toggle.getAttribute("aria-pressed");
    expect(initialPressed).not.toBe("true");

    await toggle.dispatchEvent("click");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // Clicking again deactivates it.
    await toggle.dispatchEvent("click");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("download toggle is mutually exclusive with select-area toggle", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);

    const downloadToggle = page.getByTestId("overview-download-toggle");
    const selectToggle = page.getByTestId("overview-select-area-toggle");

    await expect(downloadToggle).toBeVisible({ timeout: 5_000 });
    await expect(selectToggle).toBeVisible({ timeout: 5_000 });

    // Activate select-area first, then activate download.
    await selectToggle.dispatchEvent("click");
    await expect(selectToggle).toHaveAttribute("aria-pressed", "true");

    await downloadToggle.dispatchEvent("click");
    await expect(downloadToggle).toHaveAttribute("aria-pressed", "true");
    // Select-area must have been deactivated.
    await expect(selectToggle).toHaveAttribute("aria-pressed", "false");
  });

  test("drawing a bbox in download mode shows TerrainDownloadPopover", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);
    await drawDownloadBbox(page);

    const popover = page.getByTestId("terrain-download-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });
  });

  test("TerrainDownloadPopover has expected structure for authenticated user", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);
    await drawDownloadBbox(page);

    const popover = page.getByTestId("terrain-download-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });

    // Header text.
    await expect(popover).toContainText("↓ DOWNLOAD BATHYMETRY");

    // Resolution buttons (Low / Medium / High).
    await expect(popover.getByRole("button", { name: /Low/i })).toBeVisible();
    await expect(popover.getByRole("button", { name: /Medium/i })).toBeVisible();
    await expect(popover.getByRole("button", { name: /High/i })).toBeVisible();

    // Area summary is shown.
    await expect(popover).toContainText("AREA");
    await expect(popover).toContainText("CENTRE");

    // The download confirm button exists and is not disabled for an
    // authenticated user (it may briefly be disabled while the preflight info
    // fetch is in flight, so wait for it to become enabled).
    const confirmBtn = page.getByTestId("terrain-download-confirm");
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });

    // No auth-gate warning for a signed-in user.
    await expect(popover).not.toContainText("Sign in to download");
  });

  test("unauthenticated user sees auth-gate warning and download button is disabled", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);

    // Simulate signed-out state before the popover mounts so it renders with
    // isSignedIn=false from the first paint.  Always reset in a try/finally
    // so subsequent tests are not poisoned by a failing assertion here.
    await page.evaluate(() => {
      (
        window as unknown as {
          __bathyTest?: { setSimulateSignedOut?: (v: boolean) => void };
        }
      ).__bathyTest?.setSimulateSignedOut?.(true);
    });

    try {
      await drawDownloadBbox(page);

      const popover = page.getByTestId("terrain-download-popover");
      await expect(popover).toBeVisible({ timeout: 5_000 });

      // Auth-gate warning must be visible.
      const authGate = page.getByTestId("terrain-download-auth-gate");
      await expect(authGate).toBeVisible({ timeout: 3_000 });
      await expect(authGate).toContainText("Sign in to download");

      // Download confirm button must be disabled (isSignedIn=false disables it).
      const confirmBtn = page.getByTestId("terrain-download-confirm");
      await expect(confirmBtn).toBeDisabled({ timeout: 3_000 });
    } finally {
      // Always restore signed-in state so the worker's subsequent tests are
      // unaffected.
      await page.evaluate(() => {
        (
          window as unknown as {
            __bathyTest?: { setSimulateSignedOut?: (v: boolean) => void };
          }
        ).__bathyTest?.setSimulateSignedOut?.(false);
      });
    }
  });

  test("Cancel button dismisses the TerrainDownloadPopover", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);
    await drawDownloadBbox(page);

    const popover = page.getByTestId("terrain-download-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });

    await popover.getByRole("button", { name: /Cancel/i }).dispatchEvent("click");
    await expect(popover).toHaveCount(0, { timeout: 3_000 });
  });

  test("close (×) button dismisses the TerrainDownloadPopover", async ({
    page,
  }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);
    await drawDownloadBbox(page);

    const popover = page.getByTestId("terrain-download-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });

    await popover.getByRole("button", { name: /Close/i }).dispatchEvent("click");
    await expect(popover).toHaveCount(0, { timeout: 3_000 });
  });

  test("clicking ↓ Download triggers a CSV file download", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    await activateDownloadMode(page);
    await drawDownloadBbox(page);

    const popover = page.getByTestId("terrain-download-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });

    const confirmBtn = page.getByTestId("terrain-download-confirm");
    // Wait for the preflight info fetch to complete so the button is enabled.
    await expect(confirmBtn).toBeEnabled({ timeout: 15_000 });

    // Start listening for a download BEFORE clicking so we don't race.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      confirmBtn.dispatchEvent("click"),
    ]);

    // The file must have a .csv extension and a bathyscan_ prefix.
    expect(download.suggestedFilename()).toMatch(/^bathyscan_.*\.csv$/);

    // Popover closes after a successful download.
    await expect(popover).toHaveCount(0, { timeout: 5_000 });
  });
});
