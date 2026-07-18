import { test, expect } from "./fixtures";

/**
 * Follow-mode dataset handoff — E2E regression tests.
 *
 * Scenario: the angler is in Live mode with GPS follow active and the boat
 * "walks" out of the loaded dataset's bounds.
 *
 * - When the loadable-dataset search finds a nearby dataset, a toast offers
 *   a one-tap "Load & follow": tapping it switches the active dataset
 *   (observed via the terrain fetch for the suggested id) and re-arms follow.
 * - When the search finds nothing, the plain "Follow mode paused" toast is
 *   shown (previous behaviour).
 *
 * The handoff searches GET /api/datasets (preset list with bboxes), so that
 * endpoint is intercepted with page.route: the suggestion test appends a
 * synthetic dataset covering the out-of-bounds position; the fallback test
 * passes the real list through unchanged (the OOB point is in the remote
 * South Pacific, far from every preset... except any global dataset, so the
 * fallback test instead filters the list down to the default dataset only).
 */

// Terrain never auto-loads in the headless e2e environment, so each test
// seeds a grid via the __bathyTest bridge. The seed uses the REAL preset id
// and bbox (lake-ray-roberts) so the follow-up overview/terrain fetches the
// app fires for the active dataset succeed instead of 404-ing (a synthetic
// id's failing load pipeline resets follow state mid-test). The mock GPS
// fix sits inside that bbox so follow engages without tripping the
// out-of-bounds check on the first frame.
const SEED_DATASET = {
  datasetId: "lake-ray-roberts",
  minLon: -97.15,
  maxLon: -96.92,
  minLat: 33.3,
  maxLat: 33.52,
  centerLon: -97.035,
  centerLat: 33.41,
};
const MOCK_LAT = 33.41;
const MOCK_LON = -97.03;

// Far outside any default dataset's bounds.
const OUT_LAT = -47.25;
const OUT_LON = -126.71;

const SUGGESTED_ID = "handoff-suggest-ds";
const SUGGESTED_TITLE = "Handoff Test Basin";

function injectSettings(
  page: Parameters<typeof test.beforeEach>[0]["page"],
  patch: Record<string, unknown>,
): void {
  page.addInitScript((p) => {
    const guard = "__followHandoffInjected";
    if (sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, "1");
    try {
      const raw = localStorage.getItem("bathyscan:settings");
      const blob = raw
        ? (JSON.parse(raw) as { state?: Record<string, unknown> })
        : {};
      blob.state = { ...(blob.state ?? {}), ...p };
      localStorage.setItem("bathyscan:settings", JSON.stringify(blob));
    } catch {}
  }, patch);
}

const BASE = {
  hasSeenOnboarding: true,
  sidePaneCollapsed: false,
  sidebarMode: "explore",
  llmDisclosureAcknowledged: true,
  gpsRecordingInterval: 1000,
};

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]).catch(() => {});
  await context.setGeolocation({ latitude: MOCK_LAT, longitude: MOCK_LON, accuracy: 8 });
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
    } catch {}
  });
});

/**
 * The guided-tour overlay occasionally appears mid-test (a known racy
 * settings-sync flake elsewhere in the suite); it covers the whole screen
 * and swallows clicks. Escape dismisses it and persists hasSeenOnboarding.
 */
async function dismissOnboardingIfPresent(
  page: Parameters<typeof test.beforeEach>[0]["page"],
) {
  const tour = page.locator('[role="dialog"][aria-label="BathyScan guided tour"]');
  if (await tour.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden({ timeout: 5_000 });
  }
}

/** Enter Live mode and engage GPS follow; returns once FOLLOWING is active. */
async function engageFollow(page: Parameters<typeof test.beforeEach>[0]["page"]) {
  await page.goto("/");
  await expect(
    page.locator('[data-testid="sidebar-mode-tabs"]'),
  ).toBeVisible({ timeout: 12_000 });

  // Seed a terrain grid covering the mock GPS fix — engaging follow without
  // a loaded grid trips the out-of-bounds check on the next frame, which
  // immediately disables follow again.
  await page.waitForFunction(
    (seed) =>
      Boolean(window.__bathyTest?.seedTerrain) &&
      window.__bathyTest!.seedTerrain(seed),
    SEED_DATASET,
    { timeout: 20_000 },
  );

  await dismissOnboardingIfPresent(page);
  await page.locator('[data-testid="sidebar-mode-tab-live"]').click();
  const followToggle = page.locator('[data-testid="live-follow-toggle"]');
  await expect(followToggle).toBeEnabled({ timeout: 15_000 });
  // Depth card shows a number only once the grid is loaded and the GPS fix
  // is inside its bounds.
  await expect(page.locator('[data-testid="live-depth-value"]')).not.toHaveText(
    "—",
    { timeout: 30_000 },
  );
  await dismissOnboardingIfPresent(page);
  // Entering Live mode auto-engages follow when GPS is already active
  // (enterLiveMode), so only click the toggle if it isn't engaged yet —
  // clicking blindly would toggle follow OFF again.
  if ((await followToggle.getAttribute("aria-pressed")) !== "true") {
    await followToggle.click();
  }
  await expect(followToggle).toHaveAttribute("aria-pressed", "true", {
    timeout: 8_000,
  });
}

/** Intercept GET /api/datasets (list endpoint only, not sub-paths). */
function isDatasetListRequest(url: string): boolean {
  const { pathname } = new URL(url);
  return pathname.endsWith("/api/datasets");
}

test("walking out of bounds offers 'Load & follow' when a nearby dataset exists", async ({ page, context }) => {
  // While follow is being engaged, serve an EMPTY dataset list: the app's
  // default-dataset auto-load would otherwise switch away from the seeded
  // e2e terrain (wiping its grids and disabling follow). Once follow is
  // active, flip to the real list (+ synthetic nearby dataset) so the
  // handoff search finds it.
  let serveDatasets = false;
  await page.route(
    (url) => isDatasetListRequest(url.toString()),
    async (route) => {
      if (!serveDatasets) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
        return;
      }
      const response = await route.fetch();
      const list = (await response.json()) as Array<Record<string, unknown>>;
      list.push({
        id: SUGGESTED_ID,
        name: SUGGESTED_TITLE,
        description: "Synthetic e2e handoff dataset",
        waterType: "saltwater",
        minDepth: 10,
        maxDepth: 4000,
        centerLon: OUT_LON,
        centerLat: OUT_LAT,
        bbox: {
          minLon: OUT_LON - 1,
          minLat: OUT_LAT - 1,
          maxLon: OUT_LON + 1,
          maxLat: OUT_LAT + 1,
        },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(list),
      });
    },
  );

  injectSettings(page, BASE);
  await engageFollow(page);
  serveDatasets = true;

  // Walk out of the dataset's bounds.
  await context.setGeolocation({ latitude: OUT_LAT, longitude: OUT_LON, accuracy: 8 });

  // Suggestion toast with the one-tap action appears.
  const loadButton = page.locator('[data-testid="follow-handoff-load"]');
  await expect(loadButton).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Left dataset area").first()).toBeVisible();
  // The suggested title also appears in a hidden DatasetPanel list row, so
  // restrict the match to visible elements (the handoff toast).
  await expect(
    page
      .getByText(SUGGESTED_TITLE, { exact: false })
      .locator("visible=true")
      .first(),
  ).toBeVisible();

  // Tapping it switches the active dataset — observed via the terrain fetch
  // for the suggested id (the id is synthetic, so the fetch itself 404s; the
  // switch attempt is the behaviour under test).
  const terrainRequest = page.waitForRequest(
    (req) => req.url().includes(`/api/datasets/${SUGGESTED_ID}/terrain`),
    { timeout: 15_000 },
  );
  await loadButton.click();
  await terrainRequest;
});

test("walking out of bounds falls back to the pause toast when nothing is nearby", async ({ page, context }) => {
  // Serve an empty list while follow is engaged (prevents the default
  // dataset auto-load from replacing the seeded terrain), then only
  // datasets that do NOT cover/approach the OOB point, so the suggestion
  // search finds nothing (guards against global-coverage presets).
  let serveDatasets = false;
  await page.route(
    (url) => isDatasetListRequest(url.toString()),
    async (route) => {
      if (!serveDatasets) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        });
        return;
      }
      const response = await route.fetch();
      const list = (await response.json()) as Array<{
        bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number };
      }>;
      const filtered = list.filter((d) => {
        const b = d.bbox;
        if (!b || typeof b.minLon !== "number") return true;
        const near =
          OUT_LON >= b.minLon - 2 && OUT_LON <= b.maxLon + 2 &&
          OUT_LAT >= b.minLat - 2 && OUT_LAT <= b.maxLat + 2;
        return !near;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(filtered),
      });
    },
  );

  injectSettings(page, BASE);
  await engageFollow(page);
  serveDatasets = true;

  await context.setGeolocation({ latitude: OUT_LAT, longitude: OUT_LON, accuracy: 8 });

  await expect(page.getByText("Follow mode paused").first()).toBeVisible({
    timeout: 20_000,
  });
  // Follow toggle reflects the paused state.
  await expect(
    page.locator('[data-testid="live-follow-toggle"]'),
  ).toHaveAttribute("aria-pressed", "false", { timeout: 8_000 });
});
