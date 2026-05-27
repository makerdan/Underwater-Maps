/**
 * GPS import flow — real auth-gated end-to-end test.
 *
 * Covers the "Import GPS waypoints and fish markers" feature:
 *   - parser shape (GPX) matches POST /api/markers and POST /api/trolling-presets
 *   - waypoints in a parsed file create real markers in Postgres
 *   - routes in a parsed file create a real trolling preset with the correct
 *     waypoint sequence
 *   - the UI's "Import GPS…" entry point is reachable from DatasetPanel when
 *     the user is signed in (canvas-gated; skipped cleanly when headless
 *     Chromium can't bring up WebGL).
 *
 * Companion spec to `marker-flow-real.spec.ts` — same auth-bypass pattern.
 */
import { test, expect, type Page, type APIResponse } from "./fixtures";

const DATASET_ID = "thorne-bay";
// Must match `FAKE_DEV_USER_ID` in artifacts/bathyscan/src/lib/devAuth.ts —
// the bathyscan dev-auth bypass injects this user-id header on every
// browser-originated /api/* fetch, and per-user resources (trolling presets)
// are scoped to that id. Using a different id here would create rows in one
// user's account via the UI and then query for them as a different user.
const TEST_USER_ID = "dev-user-bypass";
const API_BASE = process.env["E2E_API_BASE_URL"] ?? "http://127.0.0.1:3151";
const authHeaders = { "x-e2e-user-id": TEST_USER_ID };

interface Marker {
  id: string;
  datasetId: string;
  lon: number;
  lat: number;
  depth: number;
  label: string;
  type: string;
}

interface TrollingPreset {
  id: string;
  name: string;
  headingDeg: number;
  speedKnots: number;
  waypoints: { lon: number; lat: number }[];
}

async function safeText(res: APIResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

async function listMarkers(page: Page, datasetId: string): Promise<Marker[]> {
  const res = await page.request.get(`${API_BASE}/api/markers?datasetId=${datasetId}`, {
    headers: authHeaders,
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as Marker[];
}

async function listPresets(page: Page): Promise<TrollingPreset[]> {
  const res = await page.request.get(`${API_BASE}/api/trolling-presets`, {
    headers: authHeaders,
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as TrollingPreset[];
}

async function cleanup(page: Page): Promise<void> {
  // Best-effort cleanup so reruns are idempotent.
  try {
    const markers = await listMarkers(page, DATASET_ID);
    for (const m of markers) {
      if (m.label.startsWith("gps-import-e2e-")) {
        await page.request.delete(`${API_BASE}/api/markers/${m.id}`, {
          headers: authHeaders,
        });
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const presets = await listPresets(page);
    for (const p of presets) {
      if (p.name.startsWith("gps-import-e2e-")) {
        await page.request.delete(`${API_BASE}/api/trolling-presets/${p.id}`, {
          headers: authHeaders,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

const RUN_TAG = String(Date.now());

// A miniature GPX with two waypoints (one in-bounds for Thorne Bay near
// 132°W/55.7°N, one well outside) plus a 3-point route. Used by both the
// parser-driven API leg and the UI leg of this spec.
const MARKER_LABEL = `gps-import-e2e-${RUN_TAG}`;
const PRESET_NAME = `gps-import-e2e-route-${RUN_TAG}`;

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="bathyscan-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="55.683" lon="-132.523">
    <ele>-25</ele>
    <name>${MARKER_LABEL}</name>
    <desc>imported by e2e</desc>
  </wpt>
  <rte>
    <name>${PRESET_NAME}</name>
    <rtept lat="55.681" lon="-132.520"/>
    <rtept lat="55.683" lon="-132.523"/>
    <rtept lat="55.685" lon="-132.526"/>
  </rte>
</gpx>`;

test.describe("GPS import — real auth-gated flow", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/datasets`);
    expect(
      res.ok(),
      `api-server unreachable at ${API_BASE}/api/datasets — Playwright webServer should have started it`,
    ).toBe(true);
  });

  test.beforeEach(async ({ page }) => {
    await cleanup(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanup(page);
  });

  test("parser-shaped POST /api/markers creates the waypoint as a real marker", async ({ page }) => {
    // Sanity: the marker label is unique to this run and not present yet.
    const before = await listMarkers(page, DATASET_ID);
    expect(before.some((m) => m.label === MARKER_LABEL)).toBe(false);

    // Mirror what GpsImportDialog sends after parseGpsFile(SAMPLE_GPX).
    const res = await page.request.post(`${API_BASE}/api/markers`, {
      headers: authHeaders,
      data: {
        datasetId: DATASET_ID,
        lon: -132.523,
        lat: 55.683,
        depth: 25, // -ele flipped to positive (below surface)
        label: MARKER_LABEL,
        notes: "imported by e2e",
        type: "fish",
      },
    });
    expect(res.status(), await safeText(res)).toBe(201);

    const after = await listMarkers(page, DATASET_ID);
    const created = after.find((m) => m.label === MARKER_LABEL);
    expect(created).toBeTruthy();
    expect(created!.lon).toBeCloseTo(-132.523, 3);
    expect(created!.lat).toBeCloseTo(55.683, 3);
    expect(created!.depth).toBe(25);
    expect(created!.type).toBe("fish");
  });

  test("parser-shaped POST /api/trolling-presets creates the route as a real preset", async ({ page }) => {
    const res = await page.request.post(`${API_BASE}/api/trolling-presets`, {
      headers: authHeaders,
      data: {
        name: PRESET_NAME,
        headingDeg: 0,
        speedKnots: 2.5,
        waypoints: [
          { lon: -132.520, lat: 55.681 },
          { lon: -132.523, lat: 55.683 },
          { lon: -132.526, lat: 55.685 },
        ],
      },
    });
    expect(res.status(), await safeText(res)).toBe(201);

    const presets = await listPresets(page);
    const created = presets.find((p) => p.name === PRESET_NAME);
    expect(created).toBeTruthy();
    expect(created!.waypoints).toHaveLength(3);
    expect(created!.waypoints[0]!.lon).toBeCloseTo(-132.520, 3);
    expect(created!.waypoints[2]!.lat).toBeCloseTo(55.685, 3);
  });

  test("unauthenticated import requests are rejected by requireAuth", async ({ page }) => {
    // Same import payloads as above, minus the bypass header → real
    // requireAuth path runs and returns 401. Proves the import flow rides on
    // the same auth gate as manual marker / preset creation.
    const markerRes = await page.request.post(`${API_BASE}/api/markers`, {
      data: {
        datasetId: DATASET_ID,
        lon: -132.523,
        lat: 55.683,
        depth: 25,
        label: `${MARKER_LABEL}-noauth`,
        type: "fish",
      },
    });
    expect(markerRes.status()).toBe(401);

    const presetRes = await page.request.post(`${API_BASE}/api/trolling-presets`, {
      data: {
        name: `${PRESET_NAME}-noauth`,
        headingDeg: 0,
        speedKnots: 2.5,
        waypoints: [
          { lon: -132.520, lat: 55.681 },
          { lon: -132.523, lat: 55.683 },
        ],
      },
    });
    expect(presetRes.status()).toBe(401);
  });

  test("Import GPS dialog opens from DatasetPanel and accepts a GPX upload", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__bathyTest, undefined, { timeout: 15_000 });

    // Forward the auth-bypass header on browser-originated /api/* fetches so
    // React Query mutations the dialog fires are accepted by the api-server.
    await page.evaluate((uid) => {
      window.__bathyTest!.setRequestHeaders({ "x-e2e-user-id": uid });
    }, TEST_USER_ID);

    // Canvas-gated: when Chromium can't bring up WebGL the signed-in tree
    // doesn't render, so the DatasetPanel never mounts. Skip cleanly rather
    // than asserting on absent DOM.
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    // Drive into the Thorne Bay dataset so terrain (and therefore the import
    // dialog's bounding-box filter) is available.
    await page.evaluate((id) => {
      window.__bathyTest!.setActiveDatasetId(id);
    }, DATASET_ID);

    // Open the Markers section, then the Import GPS dialog.
    const openBtn = page.locator('[data-testid="open-gps-import"]');
    // The Markers accordion may be collapsed by default; expand it by
    // clicking the MARKERS header if the import button isn't visible yet.
    if (!(await openBtn.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await page.getByText(/MARKERS/).first().dispatchEvent("click").catch(() => {});
    }
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.dispatchEvent("click");

    const dialog = page.locator('[data-testid="gps-import-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Attach the in-memory GPX to the hidden file input and assert the
    // preview surfaces both the waypoint and the route counts.
    await page
      .locator('[data-testid="gps-import-file-input"]')
      .setInputFiles({
        name: "trip.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(SAMPLE_GPX, "utf-8"),
      });

    await expect(page.locator('[data-testid="gps-import-waypoint-count"]')).toHaveText("1", { timeout: 5_000 });
    await expect(page.locator('[data-testid="gps-import-route-count"]')).toHaveText("1");

    // Confirming the import calls POST /api/markers and POST
    // /api/trolling-presets through the React Query mutations — which the
    // browser-side fetch wrapper carries the auth-bypass header on.
    await page.locator('[data-testid="gps-import-confirm"]').dispatchEvent("click");
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Verify the import landed in Postgres for real.
    const markers = await listMarkers(page, DATASET_ID);
    expect(markers.some((m) => m.label === MARKER_LABEL)).toBe(true);
    const presets = await listPresets(page);
    expect(presets.some((p) => p.name === PRESET_NAME)).toBe(true);
  });

  test("preview map + inline edits flow through to the created preset", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__bathyTest, undefined, { timeout: 15_000 });

    await page.evaluate((uid) => {
      window.__bathyTest!.setRequestHeaders({ "x-e2e-user-id": uid });
    }, TEST_USER_ID);

    // Canvas-gated: same guard as the upload spec above — when headless
    // Chromium has no WebGL the signed-in tree never mounts.
    const canvas = page.locator("canvas").first();
    const canvasVisible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, "Canvas not visible — user is not signed in");
      return;
    }

    await page.evaluate((id) => {
      window.__bathyTest!.setActiveDatasetId(id);
    }, DATASET_ID);

    const openBtn = page.locator('[data-testid="open-gps-import"]');
    if (!(await openBtn.isVisible({ timeout: 1_000 }).catch(() => false))) {
      await page.getByText(/MARKERS/).first().dispatchEvent("click").catch(() => {});
    }
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.dispatchEvent("click");

    const dialog = page.locator('[data-testid="gps-import-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await page
      .locator('[data-testid="gps-import-file-input"]')
      .setInputFiles({
        name: "trip.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(SAMPLE_GPX, "utf-8"),
      });

    // Preview map renders (SVG inside the wrapper).
    const previewMap = page.locator('[data-testid="gps-import-preview-map"]');
    await expect(previewMap).toBeVisible({ timeout: 5_000 });
    await expect(previewMap.locator("svg")).toBeVisible();

    // Sanity: preview counts before any edits.
    await expect(page.locator('[data-testid="gps-import-waypoint-count"]')).toHaveText("1");
    await expect(page.locator('[data-testid="gps-import-route-count"]')).toHaveText("1");

    // Rename the route. The name input is inside <details><summary>; the
    // input itself is interactive even when the details element is closed.
    const editedName = `gps-import-e2e-edited-${RUN_TAG}`;
    const nameInput = page.locator('[data-testid="gps-import-route-name-0"]');
    await nameInput.fill(editedName);
    await expect(nameInput).toHaveValue(editedName);

    // Expand the route details so the per-point remove buttons render, then
    // drop the first waypoint of the route (3 pts → 2 pts).
    await page.locator('[data-testid="gps-import-route-0"]').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.locator('[data-testid="gps-import-remove-route-point-0-0"]').dispatchEvent("click");
    // After removal the second testid disappears (only 0 and 1 remain).
    await expect(
      page.locator('[data-testid="gps-import-remove-route-point-0-2"]'),
    ).toHaveCount(0);

    // Override heading and speed.
    const heading = page.locator('[data-testid="gps-import-heading"]');
    const speed = page.locator('[data-testid="gps-import-speed"]');
    await heading.fill("123");
    await speed.fill("3.7");

    await page.locator('[data-testid="gps-import-confirm"]').dispatchEvent("click");
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Verify the edits made it all the way to the persisted preset.
    const presets = await listPresets(page);
    const created = presets.find((p) => p.name === editedName);
    expect(created, `expected preset named ${editedName}`).toBeTruthy();
    expect(created!.waypoints).toHaveLength(2);
    expect(created!.headingDeg).toBe(123);
    expect(created!.speedKnots).toBeCloseTo(3.7, 3);
    // The original preset name should not have been created.
    expect(presets.some((p) => p.name === PRESET_NAME)).toBe(false);

    // Best-effort: include the edited preset name in cleanup so this run is
    // idempotent even though `cleanup()` only matches the gps-import-e2e- prefix.
    // (editedName already starts with that prefix, so the afterEach hook
    // will sweep it up.)
  });
});
