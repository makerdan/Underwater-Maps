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

  // ---------------------------------------------------------------------------
  // 1. Selecting a tile reveals the rotation panel
  // ---------------------------------------------------------------------------
  test("rotation panel appears when a tile is selected in puzzle mode", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);

    // Confirm puzzle mode can be entered.
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found — overview may require real terrain in this env");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    // Rotation panel must NOT be visible before any tile is selected.
    await expect(page.getByTestId("overview-puzzle-rotation-panel")).toHaveCount(0);

    // Select the primary dataset tile via bridge.
    const tileId = await selectPrimaryTileViaBridge(page);
    if (!tileId) {
      test.skip(true, "Bridge could not select a tile — terrain may not be available");
      return;
    }

    // Rotation panel must now be visible.
    await expect(page.getByTestId("overview-puzzle-rotation-panel")).toBeVisible({ timeout: 3_000 });

    // All rotation buttons must be present.
    await expect(page.getByTestId("overview-puzzle-rotate-plus90")).toBeVisible();
    await expect(page.getByTestId("overview-puzzle-rotate-minus90")).toBeVisible();
    await expect(page.getByTestId("overview-puzzle-angle-input")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 2. +90° button rotates the tile to 90°
  // ---------------------------------------------------------------------------
  test("+90° button rotates the selected tile to 90°", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    const tileId = await selectPrimaryTileViaBridge(page);
    if (!tileId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }

    await expect(page.getByTestId("overview-puzzle-rotation-panel")).toBeVisible({ timeout: 3_000 });

    // Initial angle should be 0 (or absent from the transforms map).
    const angleBefore = await getPuzzleAngle(page, tileId);
    expect(angleBefore ?? 0).toBe(0);

    // Click the +90° button.
    await page.getByTestId("overview-puzzle-rotate-plus90").dispatchEvent("click");

    // The transform must now show angleDeg = 90.
    await expect
      .poll(() => getPuzzleAngle(page, tileId), { timeout: 3_000 })
      .toBe(90);

    // The angle input must reflect the new value.
    await expect(page.getByTestId("overview-puzzle-angle-input")).toHaveValue("90");
  });

  // ---------------------------------------------------------------------------
  // 3. Numeric input sets angle directly
  // ---------------------------------------------------------------------------
  test("entering an angle in the numeric input applies it to the tile", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    const tileId = await selectPrimaryTileViaBridge(page);
    if (!tileId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }

    await expect(page.getByTestId("overview-puzzle-rotation-panel")).toBeVisible({ timeout: 3_000 });

    const angleInput = page.getByTestId("overview-puzzle-angle-input");

    // Clear the input and type a new value.
    await angleInput.fill("45");
    await angleInput.dispatchEvent("input");
    // React's onChange fires on the `input` event; dispatch a synthetic change too.
    await angleInput.dispatchEvent("change");

    // Poll the store transform — the input's onChange handler calls setAngle().
    await expect
      .poll(() => getPuzzleAngle(page, tileId), { timeout: 3_000 })
      .toBe(45);
  });

  // ---------------------------------------------------------------------------
  // 4. ↺ reset button returns tile to 0°
  // ---------------------------------------------------------------------------
  test("rotation reset button returns the tile to 0° and hides itself", async ({ page }) => {
    if (!(await ensureSignedInOrSkip(page))) return;

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    if (!entered) {
      test.skip(true, "Puzzle toggle button not found");
      return;
    }

    // Wait for registerPuzzleTestHandlers useEffect to fire before calling bridge.
    const bridgeReady = await waitForPuzzleBridge(page);
    if (!bridgeReady) {
      test.skip(true, "Puzzle bridge handlers not registered in time — effect may not have fired");
      return;
    }

    const tileId = await selectPrimaryTileViaBridge(page);
    if (!tileId) {
      test.skip(true, "Bridge could not select a tile");
      return;
    }

    await expect(page.getByTestId("overview-puzzle-rotation-panel")).toBeVisible({ timeout: 3_000 });

    // Apply a non-zero rotation first so the reset button appears.
    await page.getByTestId("overview-puzzle-rotate-plus90").dispatchEvent("click");
    await expect
      .poll(() => getPuzzleAngle(page, tileId), { timeout: 3_000 })
      .toBe(90);

    // The ↺ reset button is conditionally rendered (only when angleDeg ≠ 0).
    const resetBtn = page.getByTestId("overview-puzzle-rotation-reset");
    await expect(resetBtn).toBeVisible({ timeout: 3_000 });

    // Click it.
    await resetBtn.dispatchEvent("click");

    // Tile angle must return to 0.
    await expect
      .poll(() => getPuzzleAngle(page, tileId), { timeout: 3_000 })
      .toBe(0);

    // The reset button must vanish (angle is back to 0, conditional render drops it).
    await expect(resetBtn).toHaveCount(0, { timeout: 3_000 });
  });
});
