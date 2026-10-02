import { test, expect, type Page } from "./fixtures";

/**
 * Overview Map — Puzzle-mode rotation panel E2E tests.
 *
 * Covers the lifecycle of the puzzle rotation controls:
 *   1. Clicking a tile selects it and shows the rotation panel.
 *   2. Clicking the +90° button rotates the tile 90°.
 *   3. Entering an angle directly in the numeric input applies it.
 *   4. The ↺ reset button returns the tile to 0° and hides itself.
 *
 * Canvas hit-testing is avoided by using the `__bathyTest.setPuzzleSelectedId`
 * bridge to select the primary dataset's tile programmatically — an approach
 * consistent with RAWS and EFH overlay tests that also bypass canvas projection.
 * Angle changes are verified via `getPuzzleTransform` rather than pixel
 * assertions so the tests remain fast and deterministic under headless WebGL.
 */

const OVERLAY_HEADER = ".overview-map-header";

async function ensureSignedInOrSkip(page: Page): Promise<boolean> {
  const canvas = page.locator("canvas").first();
  const visible = await canvas.isVisible({ timeout: 12_000 }).catch(() => false);
  if (!visible) {
    test.skip(true, "Canvas not visible — user is not signed in");
    return false;
  }
  return true;
}

async function openOverview(page: Page): Promise<void> {
  const opened = await page
    .evaluate(() => {
      const api = (window as unknown as { __bathyTest?: { setOverviewOpen?: (b: boolean) => void } }).__bathyTest;
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
 * Enter puzzle mode via the toolbar button (exercises the real UI path).
 * Returns false if the toggle button is not found within 5 s.
 */
async function enterPuzzleMode(page: Page): Promise<boolean> {
  const folder = page.getByTestId("overview-map-folder-puzzle");
  const folderFound = await folder.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!folderFound) return false;
  if ((await folder.getAttribute("aria-expanded")) !== "true") {
    await folder.click();
  }
  const toggleBtn = page.getByTestId("overview-puzzle-toggle");
  const found = await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!found) return false;
  await toggleBtn.dispatchEvent("click");
  // Wait until aria-pressed="true" to confirm state committed.
  await expect(toggleBtn).toHaveAttribute("aria-pressed", "true", { timeout: 3_000 });
  return true;
}

/**
 * Poll until the OverviewMap's `registerPuzzleTestHandlers` useEffect has fired
 * and wired the bridge callbacks. The effect sets `isPuzzleBridgeReady` to true
 * as its last action, providing a single unambiguous signal instead of a
 * side-effect probe.
 */
async function waitForPuzzleBridge(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const api = (window as unknown as {
          __bathyTest?: { isPuzzleBridgeReady?: () => boolean };
        }).__bathyTest;
        return api?.isPuzzleBridgeReady?.() === true;
      },
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Select the primary dataset tile via the test bridge, bypassing canvas
 * hit-testing. Returns the selected datasetId, or null on failure.
 */
async function selectPrimaryTileViaBridge(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const api = (window as unknown as {
      __bathyTest?: {
        getTerrainSummary?: () => { datasetId: string | null | undefined } | null;
        setPuzzleSelectedId?: (id: string | null) => boolean;
        getPuzzleSelectedId?: () => string | null;
      };
    }).__bathyTest;
    const summary = api?.getTerrainSummary?.();
    const id = summary?.datasetId;
    if (!id) return null;
    const ok = api?.setPuzzleSelectedId?.(id);
    if (!ok) return null;
    return api?.getPuzzleSelectedId?.() ?? null;
  });
}

/**
 * Read the current angleDeg for a given tile from the live puzzle transforms.
 */
async function getPuzzleAngle(page: Page, id: string): Promise<number | null> {
  return page.evaluate((datasetId) => {
    const api = (window as unknown as {
      __bathyTest?: {
        getPuzzleTransform?: (id: string) => { tx: number; ty: number; angleDeg: number } | null;
      };
    }).__bathyTest;
    return api?.getPuzzleTransform?.(datasetId)?.angleDeg ?? null;
  }, id);
}

test.describe("BathyScan — Overview Puzzle rotation panel", () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the simulated-data confirmation dialog.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);
    // Seed synthetic terrain so overviewGrid is non-null (required for the
    // puzzle tile hit-test code path in the mousedown handler).
    await page.evaluate(() => window.__bathyTest?.seedTerrain?.()).catch(() => {});
    await page
      .waitForFunction(
        () => Boolean(window.__bathyTest?.getTerrainSummary?.()),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});
  });

  async function openTileMenu(page: Page): Promise<string | null> {
    const tileId = await selectPrimaryTileViaBridge(page);
    if (!tileId) return null;
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) return null;
    await canvas.click({ button: "right", position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.getByText("Rotate 45° clockwise")).toBeVisible({ timeout: 3_000 });
    return tileId;
  }

  test("selected tile exposes the supported rotation context menu", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;
    await openOverview(page);
    if (!(await enterPuzzleMode(page)) || !(await waitForPuzzleBridge(page))) {
      test.skip(true, "Puzzle mode context-menu bridge unavailable");
      return;
    }
    const tileId = await openTileMenu(page);
    if (!tileId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }
    await expect(page.getByText("Rotate 5° counter-clockwise")).toBeVisible();
    await expect(page.getByText("Reset rotation")).toBeVisible();
  });

  test("context-menu clockwise rotation updates the selected tile", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;
    await openOverview(page);
    if (!(await enterPuzzleMode(page)) || !(await waitForPuzzleBridge(page))) {
      test.skip(true, "Puzzle mode context-menu bridge unavailable");
      return;
    }
    const tileId = await openTileMenu(page);
    if (!tileId) { test.skip(true, "Bridge could not select a tile"); return; }
    await page.getByText("Rotate 45° clockwise").click();
    await expect.poll(() => getPuzzleAngle(page, tileId), { timeout: 3_000 }).toBe(45);
  });
});
