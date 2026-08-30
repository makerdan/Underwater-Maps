import { test, expect, apiUrl, E2E_USER_ID } from "./fixtures";
import { overviewMapCanvas } from "./_helpers/canvases";
import { computeBgAnchorAffine, computeBgFallbackRect } from "../../artifacts/bathyscan/src/lib/overviewRenderer/puzzle";
import {
  canvasToLonLat,
  lonLatToCanvas,
} from "../../artifacts/bathyscan/src/lib/overviewRenderer/transforms";
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

type BackgroundDrawSnapshot = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

type BackgroundDrawTraceWindow = Window & {
  __bathyBackgroundDraws?: BackgroundDrawSnapshot[];
  __bathyBackgroundDrawCount?: number;
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

function assertRenderedBackgroundMatchesOverlay(
  overlay: OverlaySnapshot,
  draw: BackgroundDrawSnapshot | null,
): void {
  expect(draw).not.toBeNull();
  const affine = computeBgAnchorAffine(overlay.anchors ?? [], overlay.grid as TerrainData, overlay.transform);
  expect(affine).not.toBeNull();
  // Chromium exposes the canvas matrix as float32-backed DOMMatrix values,
  // while the expected affine is calculated in JavaScript double precision.
  const actual = [draw!.a, draw!.b, draw!.c, draw!.d, draw!.e, draw!.f];
  const expected = [affine!.a, affine!.b, affine!.c, affine!.d, affine!.e, affine!.f];
  for (let index = 0; index < actual.length; index += 1) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(0.01);
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

async function installBackgroundDrawTrace(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    const contextPrototype = CanvasRenderingContext2D.prototype;
    const traceWindow = window as BackgroundDrawTraceWindow;
    const originalDrawImage = contextPrototype.drawImage;
    const prototypeWithMarker = contextPrototype as CanvasRenderingContext2D & {
      __bathyBackgroundDrawTraceInstalled?: boolean;
    };
    if (prototypeWithMarker.__bathyBackgroundDrawTraceInstalled) return;
    prototypeWithMarker.__bathyBackgroundDrawTraceInstalled = true;

    contextPrototype.drawImage = function (
      this: CanvasRenderingContext2D,
      image: CanvasImageSource,
      ...args: number[]
    ) {
      const canvas = this.canvas;
      const source = image as unknown as {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      };
      const sourceWidth = source.naturalWidth ?? source.width ?? 0;
      const sourceHeight = source.naturalHeight ?? source.height ?? 0;
      if (
        canvas?.dataset.testid === "overview-map-canvas" &&
        args.length === 2 &&
        sourceWidth === 1 &&
        sourceHeight === 1
      ) {
        const matrix = this.getTransform();
        const draws = traceWindow.__bathyBackgroundDraws ?? [];
        draws.push({
          a: matrix.a,
          b: matrix.b,
          c: matrix.c,
          d: matrix.d,
          e: matrix.e,
          f: matrix.f,
        });
        traceWindow.__bathyBackgroundDrawCount =
          (traceWindow.__bathyBackgroundDrawCount ?? 0) + 1;
        if (draws.length > 200) draws.shift();
        traceWindow.__bathyBackgroundDraws = draws;
      }
      return Reflect.apply(originalDrawImage, this, [image, ...args]);
    };
  });
}

function makeCsv(minLon: number): Buffer {
  const rows = ["lon,lat,depth"];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      rows.push(`${minLon + x / 31},${y / 31},${80 + x + y}`);
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

async function readBackgroundDrawState(page: import("@playwright/test").Page): Promise<{
  count: number;
  latest: BackgroundDrawSnapshot | null;
}> {
  return page.evaluate(() => {
    const traceWindow = window as BackgroundDrawTraceWindow;
    const draws = traceWindow.__bathyBackgroundDraws ?? [];
    return {
      count: traceWindow.__bathyBackgroundDrawCount ?? 0,
      latest: draws.at(-1) ?? null,
    };
  });
}

async function createSpecialCollectionWithMember(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  collectionName: string,
): Promise<{ collectionId: string; datasetId: string }> {
  const uploaded = await request.post(apiUrl("/api/datasets/upload"), {
    headers: AUTH_HEADERS,
    multipart: {
      file: {
        name: `reference-zoom-${Date.now()}.csv`,
        mimeType: "text/csv",
        buffer: makeCsv(-0.8),
      },
      resolution: "32",
    },
    timeout: 120_000,
  });
  expect(uploaded.ok()).toBeTruthy();
  const { savedDatasetId: datasetId } = await uploaded.json() as { savedDatasetId: string };

  await page.goto("/");
  await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("btn-new-collection").click();
  await page.getByTestId("input-new-collection").fill(collectionName);
  await page.getByTestId("input-new-collection-special").check();
  await page.getByTestId("btn-create-collection").click();

  const settingsSheet = page.locator('[data-testid^="collection-settings-sheet-"]');
  await expect(settingsSheet).toBeVisible();
  const collectionId = await settingsSheet.getAttribute("data-testid").then((value) =>
    value?.replace("collection-settings-sheet-", "") ?? null,
  );
  if (!collectionId) throw new Error("Special collection settings did not expose a collection id.");

  const added = await request.post(apiUrl(`/api/user/collections/${collectionId}/members`), {
    headers: { ...AUTH_HEADERS, "content-type": "application/json" },
    data: { datasetId },
  });
  expect(added.ok()).toBeTruthy();
  return { collectionId, datasetId };
}

async function createReadyAnchoredSpecialCollection(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  collectionName: string,
): Promise<{ collectionId: string; datasetId: string }> {
  const { collectionId, datasetId } = await createSpecialCollectionWithMember(
    page,
    request,
    collectionName,
  );

  await page.getByTestId(`input-collection-bg-file-${collectionId}`).setInputFiles({
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

  await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click();
  // The image upload is persisted asynchronously; reload so activation consumes
  // the confirmed server record and not the local draft.
  await page.reload();
  await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId(`btn-activate-collection-${collectionId}`).click();
  await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 12_000 });
  await page.waitForFunction(
    ({ collectionId, datasetId }) => {
      const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
      const scope = window.__bathyTest?.getCollectionScope?.();
      return Boolean(
        overlay?.imageReady &&
          overlay.collectionId === collectionId &&
          scope?.collectionId === collectionId &&
          scope.datasetIds?.includes(datasetId) &&
          scope.loadedDatasetIds.includes(datasetId),
      );
    },
    { collectionId, datasetId },
    { timeout: 20_000 },
  );
  return { collectionId, datasetId };
}

test.describe("Special collection reference-image anchors", () => {
  test("server-confirmed anchors survive reload and remain registered while panning and zooming", async ({
    page,
    request,
  }) => {
    const collectionName = `Anchor reload ${Date.now()}`;
    let collectionId: string | null = null;
    let datasetId: string | null = null;

    try {
      const seeded = await createSpecialCollectionWithMember(page, request, collectionName);
      collectionId = seeded.collectionId;
      datasetId = seeded.datasetId;

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
      await page.waitForFunction(
        ({ collectionId, datasetId }) => {
          const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          const scope = window.__bathyTest?.getCollectionScope?.();
          return Boolean(
            overlay?.imageReady &&
              overlay.collectionId === collectionId &&
              scope?.collectionId === collectionId &&
              scope.datasetIds?.includes(datasetId) &&
              scope.loadedDatasetIds.includes(datasetId),
          );
        },
        { collectionId, datasetId },
        { timeout: 20_000 },
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
      if (datasetId) {
        await request
          .delete(apiUrl(`/api/user/datasets/${datasetId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
    }
  });

  test("keeps the rendered reference image aligned through toolbar round trips and pointer zoom", async ({
    page,
    request,
  }) => {
    const collectionName = `Zoom drift ${Date.now()}`;
    let collectionId: string | null = null;
    let datasetId: string | null = null;

    try {
      await installBackgroundDrawTrace(page);
      const seeded = await createReadyAnchoredSpecialCollection(page, request, collectionName);
      collectionId = seeded.collectionId;
      datasetId = seeded.datasetId;
      const canvas = overviewMapCanvas(page);

      await page.waitForFunction(
        () => {
          const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          const draws = (window as BackgroundDrawTraceWindow).__bathyBackgroundDraws;
          return Boolean(overlay?.imageReady && draws && draws.length > 0);
        },
        null,
        { timeout: 8_000 },
      );

      const initial = await readLiveOverlay(page);
      expect(initial).not.toBeNull();
      expect(initial!.placement).toBe("anchors");
      expect(initial!.puzzleMode).toBe(true);
      assertAnchorsAlignAtLiveView(initial!);
      assertRenderedBackgroundMatchesOverlay(
        initial!,
        (await readBackgroundDrawState(page)).latest,
      );

      const initialTransform = initial!.transform;
      for (let round = 0; round < 3; round += 1) {
        const beforeZoomIn = await readLiveOverlay(page);
        expect(beforeZoomIn).not.toBeNull();
        await page.getByTestId("overview-zoom-in").click();
        await page.waitForFunction(
          (targetScale) => {
            const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
            return Boolean(overlay && overlay.transform.scale >= targetScale - 0.000001);
          },
          beforeZoomIn!.transform.scale * 1.35,
          { timeout: 5_000 },
        );
        const zoomedIn = await readLiveOverlay(page);
        expect(zoomedIn).not.toBeNull();
        assertAnchorsAlignAtLiveView(zoomedIn!);
        assertRenderedBackgroundMatchesOverlay(
          zoomedIn!,
          (await readBackgroundDrawState(page)).latest,
        );

        const beforeZoomOut = await readLiveOverlay(page);
        expect(beforeZoomOut).not.toBeNull();
        await page.getByTestId("overview-zoom-out").click();
        await page.waitForFunction(
          (targetScale) => {
            const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
            return Boolean(
              overlay && Math.abs(overlay.transform.scale - targetScale) < 0.000001,
            );
          },
          initialTransform.scale,
          { timeout: 5_000 },
        );
        const restored = await readLiveOverlay(page);
        expect(restored).not.toBeNull();
        expect(restored!.transform.scale).toBeCloseTo(initialTransform.scale, 6);
        expect(restored!.transform.offsetX).toBeCloseTo(initialTransform.offsetX, 6);
        expect(restored!.transform.offsetY).toBeCloseTo(initialTransform.offsetY, 6);
        assertAnchorsAlignAtLiveView(restored!);
        assertRenderedBackgroundMatchesOverlay(
          restored!,
          (await readBackgroundDrawState(page)).latest,
        );
      }

      const box = await canvas.boundingBox();
      if (!box) throw new Error("Overview canvas was not available for pointer zoom test.");
      const pointerMetrics = await canvas.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const clientX = Math.round(rect.left + rect.width * 0.68);
        const clientY = Math.round(rect.top + rect.height * 0.38);
        return {
          clientX,
          clientY,
          x: (clientX - rect.left) * element.width / Math.max(1, rect.width),
          y: (clientY - rect.top) * element.height / Math.max(1, rect.height),
        };
      });
      const pointer = { x: pointerMetrics.x, y: pointerMetrics.y };
      const pointerBefore = await readLiveOverlay(page);
      expect(pointerBefore).not.toBeNull();
      const pointerGeoBefore = canvasToLonLat(
        pointer.x,
        pointer.y,
        pointerBefore!.grid as TerrainData,
        pointerBefore!.transform,
      );
      await page.mouse.move(pointerMetrics.clientX, pointerMetrics.clientY);
      await page.mouse.wheel(0, -120);
      await page.waitForFunction(
        (targetScale) => {
          const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          return Boolean(overlay && overlay.transform.scale >= targetScale - 0.000001);
        },
        pointerBefore!.transform.scale * 1.15,
        { timeout: 5_000 },
      );
      const pointerAfter = await readLiveOverlay(page);
      expect(pointerAfter).not.toBeNull();
      const pointerGeoAfter = canvasToLonLat(
        pointer.x,
        pointer.y,
        pointerAfter!.grid as TerrainData,
        pointerAfter!.transform,
      );
      expect(pointerGeoAfter.lon).toBeCloseTo(pointerGeoBefore.lon, 6);
      expect(pointerGeoAfter.lat).toBeCloseTo(pointerGeoBefore.lat, 6);
      assertAnchorsAlignAtLiveView(pointerAfter!);
      assertRenderedBackgroundMatchesOverlay(
        pointerAfter!,
        (await readBackgroundDrawState(page)).latest,
      );
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
      if (datasetId) {
        await request
          .delete(apiUrl(`/api/user/datasets/${datasetId}`), { headers: AUTH_HEADERS })
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
    let datasetId: string | null = null;

    try {
      const seeded = await createSpecialCollectionWithMember(page, request, collectionName);
      collectionId = seeded.collectionId;
      datasetId = seeded.datasetId;

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
      await page.waitForFunction(
        ({ collectionId, datasetId }) => {
          const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          const scope = window.__bathyTest?.getCollectionScope?.();
          return Boolean(
            overlay?.imageReady &&
              overlay.collectionId === collectionId &&
              scope?.collectionId === collectionId &&
              scope.datasetIds?.includes(datasetId) &&
              scope.loadedDatasetIds.includes(datasetId),
          );
        },
        { collectionId, datasetId },
        { timeout: 20_000 },
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
      if (datasetId) {
        await request
          .delete(apiUrl(`/api/user/datasets/${datasetId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
    }
  });
});
