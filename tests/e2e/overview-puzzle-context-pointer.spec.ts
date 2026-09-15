import { test, expect, type Page } from "./fixtures";

const OVERLAY_HEADER = ".overview-map-header";
const BASE_TILE_ID = "e2e-puzzle-base";
const TOP_TILE_ID = "e2e-puzzle-top";
const TRANSFORM_KEY = "bathyscan:puzzleTransforms";

const TOP_TILE_TRANSFORM = {
  tx: 42,
  ty: -28,
  angleDeg: 30,
  flipH: false,
  flipV: false,
};

async function openOverview(page: Page): Promise<void> {
  const opened = await page
    .evaluate(() => {
      const api = window.__bathyTest;
      if (api?.setOverviewOpen) {
        api.setOverviewOpen(true);
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (!opened) {
    await page.getByRole("button", { name: /▲\s*OVERVIEW/ }).click();
  }
  await expect(page.locator(OVERLAY_HEADER)).toBeVisible({ timeout: 5_000 });
}

async function enterPuzzleMode(page: Page): Promise<boolean> {
  const folder = page.getByTestId("overview-map-folder-puzzle");
  if (!(await folder.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  if ((await folder.getAttribute("aria-expanded")) !== "true") {
    await folder.click();
  }

  const toggle = page.getByTestId("overview-puzzle-toggle");
  if (!(await toggle.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 3_000 });
  return true;
}

async function getPuzzleTransform(page: Page, datasetId: string) {
  return page.evaluate((id) => window.__bathyTest?.getPuzzleTransform?.(id) ?? null, datasetId);
}

/**
 * Return the browser-space point at the transformed top tile's center.
 * Using the live OverviewMap transform avoids hardcoding a viewport size while
 * still exercising the canvas's native contextmenu listener with real pointer
 * coordinates.
 */
async function getTopTileCenter(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((tileId) => {
    const snapshot = window.__bathyTest?.getCollectionOverviewSnapshot?.();
    const header = document.querySelector(".overview-map-header");
    const canvas = header?.parentElement?.querySelector("canvas");
    const tile = snapshot?.tiles.find((entry) => entry.datasetId === tileId);
    if (!snapshot || !canvas || !tile) return null;

    const { minLon, maxLon, minLat, maxLat } = snapshot.worldGrid;
    const { scale, offsetX, offsetY, pxPerDeg } = snapshot.transform;
    const lonRange = maxLon - minLon || 1;
    const latRange = maxLat - minLat || 1;
    const terrainWidth = pxPerDeg * lonRange * scale;
    const terrainHeight = pxPerDeg * latRange * scale;
    const centerLon = (tile.minLon + tile.maxLon) / 2;
    const centerLat = (tile.minLat + tile.maxLat) / 2;
    const centerX = offsetX + ((centerLon - minLon) / lonRange) * terrainWidth;
    const centerY = offsetY + ((maxLat - centerLat) / latRange) * terrainHeight;
    const rect = canvas.getBoundingClientRect();

    return {
      x: rect.left + centerX + tile.transform.tx,
      y: rect.top + centerY + tile.transform.ty,
    };
  }, TOP_TILE_ID);

  if (!point) throw new Error("Could not resolve the transformed top tile center");
  return point;
}

test.describe("BathyScan — puzzle context actions through browser pointer events", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
      } catch {}
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => Boolean(window.__bathyTest), null, { timeout: 10_000 });
  });

  test("right-clicks the translated rotated top tile and changes only that tile", async ({ page }) => {
    const seeded = await page.evaluate(
      ({ baseId, topId, transform, transformKey }) => {
        const ok = window.__bathyTest?.seedPuzzleTiles?.([
          {
            datasetId: baseId,
            name: "E2E Puzzle Base",
            minLon: -1,
            maxLon: 1,
            minLat: -1,
            maxLat: 1,
            dataUpdatedAt: "2024-01-01T00:00:00.000Z",
          },
          {
            datasetId: topId,
            name: "E2E Puzzle Top",
            minLon: -1,
            maxLon: 1,
            minLat: -1,
            maxLat: 1,
            dataUpdatedAt: "2025-01-01T00:00:00.000Z",
          },
        ]);
        if (!ok) return false;
        sessionStorage.setItem(transformKey, JSON.stringify([[topId, transform]]));
        return true;
      },
      {
        baseId: BASE_TILE_ID,
        topId: TOP_TILE_ID,
        transform: TOP_TILE_TRANSFORM,
        transformKey: TRANSFORM_KEY,
      },
    );
    expect(seeded).toBe(true);

    await openOverview(page);
    const entered = await enterPuzzleMode(page);
    expect(entered).toBe(true);

    await expect
      .poll(
        () => page.evaluate(() => window.__bathyTest?.getCollectionOverviewSnapshot?.()?.tiles.length ?? 0),
        { timeout: 5_000 },
      )
      .toBe(2);
    await expect
      .poll(() => getPuzzleTransform(page, TOP_TILE_ID), { timeout: 5_000 })
      .toMatchObject(TOP_TILE_TRANSFORM);

    const topCenter = await getTopTileCenter(page);
    await page.mouse.click(topCenter.x, topCenter.y, { button: "right" });

    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.getByRole("menuitem", { name: "Flip H" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Rotate 45° clockwise" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Add note" })).toBeVisible();

    await menu.getByRole("menuitem", { name: "Flip H" }).click();
    await expect
      .poll(() => getPuzzleTransform(page, TOP_TILE_ID), { timeout: 3_000 })
      .toMatchObject({ ...TOP_TILE_TRANSFORM, flipH: true });
    expect(await getPuzzleTransform(page, BASE_TILE_ID)).toBeNull();

    await page.mouse.click(topCenter.x, topCenter.y, { button: "right" });
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitem", { name: "Rotate 45° clockwise" }).click();
    await expect
      .poll(() => getPuzzleTransform(page, TOP_TILE_ID), { timeout: 3_000 })
      .toMatchObject({ tx: 42, ty: -28, angleDeg: 75, flipH: true, flipV: false });
    expect(await getPuzzleTransform(page, BASE_TILE_ID)).toBeNull();

    await page.mouse.click(topCenter.x, topCenter.y, { button: "right" });
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitem", { name: "Add note" }).click();

    const annotationInput = page.getByTestId("overview-puzzle-annotation-input");
    await expect(annotationInput).toBeVisible();
    await annotationInput.fill("translated top tile");
    await page.getByTestId("overview-puzzle-annotation-confirm").click();

    await expect
      .poll(() => getPuzzleTransform(page, TOP_TILE_ID), { timeout: 3_000 })
      .toMatchObject({
        tx: 42,
        ty: -28,
        angleDeg: 75,
        flipH: true,
        flipV: false,
        annotation: "translated top tile",
      });
    expect(await getPuzzleTransform(page, BASE_TILE_ID)).toBeNull();
  });
});