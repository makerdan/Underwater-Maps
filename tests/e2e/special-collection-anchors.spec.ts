import { test, expect, apiUrl, E2E_USER_ID } from "./fixtures";
import { overviewMapCanvas } from "./_helpers/canvases";
import { computeBgAnchorAffine, computeBgFallbackRect } from "../../artifacts/bathyscan/src/lib/overviewRenderer/puzzle";
import { lonLatToCanvas } from "../../artifacts/bathyscan/src/lib/overviewRenderer/transforms";
import type { TerrainData } from "@workspace/api-client-react";

const AUTH_HEADERS = {
  "x-e2e-user-id": E2E_USER_ID,
  "x-e2e-bypass-secret": "e2e-playwright-secret",
};

type OverlaySnapshot = {
  collectionId: string;
  anchors: Array<{ lon: number; lat: number; imgX: number; imgY: number }> | null;
  imageReady: boolean;
  puzzleMode: boolean;
  placement: "anchors" | "dataset-bounds";
  opacity: number;
  transform: { scale: number; offsetX: number; offsetY: number; pxPerDeg: number };
  grid: { minLon: number; maxLon: number; minLat: number; maxLat: number };
};

function assertAnchorsAlignAtLiveView(overlay: OverlaySnapshot): void {
  expect(overlay.anchors).not.toBeNull();
  const grid = overlay.grid as TerrainData;
  const affine = computeBgAnchorAffine(overlay.anchors!, grid, overlay.transform);
  expect(affine).not.toBeNull();
  for (const anchor of overlay.anchors!) {
    const mappedX = affine!.a * anchor.imgX + affine!.c * anchor.imgY + affine!.e;
    const mappedY = affine!.b * anchor.imgX + affine!.d * anchor.imgY + affine!.f;
    const [targetX, targetY] = lonLatToCanvas(anchor.lon, anchor.lat, grid, overlay.transform);
    expect(mappedX).toBeCloseTo(targetX, 6);
    expect(mappedY).toBeCloseTo(targetY, 6);
  }
}

function assertFallbackCoversDatasetBounds(overlay: OverlaySnapshot): void {
  const grid = overlay.grid as TerrainData;
  const rect = computeBgFallbackRect(
    [{ minLon: grid.minLon, maxLon: grid.maxLon, minLat: grid.minLat, maxLat: grid.maxLat }],
    grid,
    overlay.transform,
  );
  expect(rect).not.toBeNull();
  expect(rect!.w).toBeGreaterThan(0);
  expect(rect!.h).toBeGreaterThan(0);
}

async function readLiveOverlay(page: import("@playwright/test").Page): Promise<OverlaySnapshot | null> {
  return page.evaluate(() =>
    window.__bathyTest?.getActiveSpecialCollectionOverlay?.() ?? null,
  );
}

test.describe("Special collection reference-image anchors", () => {
  test("server-confirmed anchors survive reload and remain registered while panning and zooming", async ({
    page,
    request,
  }) => {
    const collectionName = `Anchor reload ${Date.now()}`;
    let collectionId: string | null = null;

    try {
      await page.goto("/");
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });

      await page.getByTestId("btn-new-collection").click();
      await page.getByTestId("input-new-collection").fill(collectionName);
      await page.getByTestId("input-new-collection-special").check();
      await page.getByTestId("btn-create-collection").click();

      const settingsSheet = page.locator('[data-testid^="collection-settings-sheet-"]');
      await expect(settingsSheet).toBeVisible();
      collectionId = await settingsSheet.getAttribute("data-testid").then((value) =>
        value?.replace("collection-settings-sheet-", "") ?? null,
      );
      if (!collectionId) throw new Error("Special collection settings did not expose a collection id.");

      // A 1×1 PNG is sufficient here: the two clicks round to distinct image
      // points (0,0) and (1,1), while keeping the browser upload deterministic.
      await page
        .getByTestId(`input-collection-bg-file-${collectionId}`)
        .setInputFiles({
          name: "reference.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==",
            "base64",
          ),
        });
      const preview = page.getByTestId(`collection-bg-preview-${collectionId}`);
      await expect(preview).toBeVisible();

      await page.getByTestId(`btn-pin-anchor-a-${collectionId}`).click();
      await preview.click({ position: { x: 20, y: 20 } });
      await page.getByTestId(`btn-pin-anchor-b-${collectionId}`).click();
      await preview.click({ position: { x: 280, y: 280 } });

      await page.getByTestId(`input-anchor-a-lon-${collectionId}`).fill("-0.8");
      await page.getByTestId(`input-anchor-a-lat-${collectionId}`).fill("0.8");
      await page.getByTestId(`input-anchor-b-lon-${collectionId}`).fill("0.8");
      await page.getByTestId(`input-anchor-b-lat-${collectionId}`).fill("-0.8");
      await expect(page.getByTestId(`btn-save-anchors-${collectionId}`)).toBeEnabled();
      await page.getByTestId(`btn-save-anchors-${collectionId}`).click();
      await expect(page.getByTestId(`anchor-save-status-${collectionId}`)).toContainText(
        "live reference image is now GPS-registered",
      );

      // Leave an unsaved local edit behind. A subsequent server refresh must
      // restore the confirmed values rather than treating this draft as truth.
      await page.getByTestId(`input-anchor-a-lon-${collectionId}`).fill("-0.6");
      await page.reload();
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await page.getByTestId(`btn-collection-settings-${collectionId}`).click();
      await expect(page.getByTestId(`input-anchor-a-lon-${collectionId}`)).toHaveValue("-0.8");
      await expect(page.getByTestId(`input-anchor-a-lat-${collectionId}`)).toHaveValue("0.8");
      await expect(page.getByTestId(`input-anchor-b-lon-${collectionId}`)).toHaveValue("0.8");
      await expect(page.getByTestId(`input-anchor-b-lat-${collectionId}`)).toHaveValue("-0.8");
      await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click();

      await page.getByTestId(`btn-activate-collection-${collectionId}`).click();
      await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 12_000 });
      await page.evaluate(() => window.__bathyTest?.seedTerrain?.());
      await page.waitForFunction(
        () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.()?.imageReady === true,
        null,
        { timeout: 8_000 },
      );

      const before = await readLiveOverlay(page);
      expect(before).not.toBeNull();
      expect(before!.collectionId).toBe(collectionId);
      expect(before!.puzzleMode).toBe(true);
      expect(before!.placement).toBe("anchors");
      expect(before!.opacity).toBe(0.5);
      expect(before!.anchors).toEqual([
        { imgX: 0, imgY: 0, lon: -0.8, lat: 0.8 },
        { imgX: 1, imgY: 1, lon: 0.8, lat: -0.8 },
      ]);
      assertAnchorsAlignAtLiveView(before!);

      await page.setViewportSize({ width: 390, height: 740 });
      await page.waitForFunction(
        () => window.innerWidth === 390,
        { timeout: 5_000 },
      );
      await page.setViewportSize({ width: 1280, height: 812 });
      await page.waitForFunction(
        () => window.innerWidth === 1280,
        { timeout: 5_000 },
      );
      await page.waitForFunction(
        () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.() !== null,
        null,
        { timeout: 5_000 },
      );
      const afterResize = await readLiveOverlay(page);
      expect(afterResize).not.toBeNull();
      expect(afterResize!.anchors).toEqual(before!.anchors);
      expect(afterResize!.opacity).toBe(before!.opacity);
      assertAnchorsAlignAtLiveView(afterResize!);

      await page.getByTestId("overview-zoom-in").click();
      const canvas = overviewMapCanvas(page);
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Overview canvas was not available for pan test.");
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.63, box.y + box.height * 0.42, { steps: 4 });
      await page.mouse.up();

      await page.waitForFunction(
        (previous) => {
          const current = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          return Boolean(
            current &&
              current.transform.scale > previous.scale &&
              (current.transform.offsetX !== previous.offsetX ||
                current.transform.offsetY !== previous.offsetY),
          );
        },
        afterResize!.transform,
        { timeout: 5_000 },
      );
      const after = await readLiveOverlay(page);
      expect(after).not.toBeNull();
      expect(after!.anchors).toEqual(afterResize!.anchors);
      expect(after!.opacity).toBe(afterResize!.opacity);
      assertAnchorsAlignAtLiveView(after!);
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
    }
  });

  test("dataset-bounds fallback stays aligned and opaque after resize, zoom, and pan", async ({
    page,
    request,
  }) => {
    const collectionName = `Fallback resize ${Date.now()}`;
    let collectionId: string | null = null;

    try {
      await page.goto("/");
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await page.getByTestId("btn-new-collection").click();
      await page.getByTestId("input-new-collection").fill(collectionName);
      await page.getByTestId("input-new-collection-special").check();
      await page.getByTestId("btn-create-collection").click();

      const settingsSheet = page.locator('[data-testid^="collection-settings-sheet-"]');
      await expect(settingsSheet).toBeVisible();
      collectionId = await settingsSheet.getAttribute("data-testid").then((value) =>
        value?.replace("collection-settings-sheet-", "") ?? null,
      );
      if (!collectionId) throw new Error("Special collection settings did not expose a collection id.");

      await page.getByTestId(`input-collection-bg-file-${collectionId}`).setInputFiles({
        name: "fallback.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL4WQAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await expect(page.getByTestId(`collection-bg-preview-${collectionId}`)).toBeVisible();
      await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click();
      // The upload updates the server record asynchronously; reload so the
      // collection row carries the confirmed bgImageKey before activation.
      await page.reload();
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await page.getByTestId(`btn-activate-collection-${collectionId}`).click();
      await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 12_000 });
      await page.evaluate(() => window.__bathyTest?.seedTerrain?.());
      await page.waitForFunction(
        () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.()?.imageReady === true,
        null,
        { timeout: 8_000 },
      );

      const before = await readLiveOverlay(page);
      expect(before).not.toBeNull();
      expect(before!.collectionId).toBe(collectionId);
      expect(before!.placement).toBe("dataset-bounds");
      expect(before!.anchors).toBeNull();
      expect(before!.opacity).toBe(0.5);
      assertFallbackCoversDatasetBounds(before!);

      await page.setViewportSize({ width: 390, height: 740 });
      await page.waitForFunction(
        () => window.innerWidth === 390,
        { timeout: 5_000 },
      );
      await page.setViewportSize({ width: 1280, height: 812 });
      await page.waitForFunction(
        () => window.innerWidth === 1280,
        { timeout: 5_000 },
      );
      await page.getByTestId("overview-zoom-in").click();
      const canvas = overviewMapCanvas(page);
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Overview canvas was not available for fallback pan test.");
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.43, { steps: 4 });
      await page.mouse.up();

      await page.waitForFunction(
        (previous) => {
          const current = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          return Boolean(
            current &&
              current.transform.scale > previous.scale &&
              (current.transform.offsetX !== previous.offsetX ||
                current.transform.offsetY !== previous.offsetY),
          );
        },
        before!.transform,
        { timeout: 5_000 },
      );
      const after = await readLiveOverlay(page);
      expect(after).not.toBeNull();
      expect(after!.placement).toBe("dataset-bounds");
      expect(after!.anchors).toBeNull();
      expect(after!.opacity).toBe(before!.opacity);
      assertFallbackCoversDatasetBounds(after!);
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
    }
  });
});
