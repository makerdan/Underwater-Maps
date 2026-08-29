import { test, expect, apiUrl, E2E_USER_ID } from "./fixtures";
import { overviewMapCanvas } from "./_helpers/canvases";

const AUTH_HEADERS = {
  "x-e2e-user-id": E2E_USER_ID,
  "x-e2e-bypass-secret": "e2e-playwright-secret",
};

function makeCsv(minLon: number): Buffer {
  const rows = ["lon,lat,depth"];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      rows.push(`${minLon + x / 31},${y / 31},${80 + x + y}`);
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

test("an oversized collection opens all previews and drops into the selected member", async ({
  page,
  request,
}) => {
  const datasetIds: string[] = [];
  let collectionId: string | null = null;
  try {
    for (let i = 0; i < 4; i++) {
      const response = await request.post(apiUrl("/api/datasets/upload"), {
        headers: AUTH_HEADERS,
        multipart: {
          file: {
            name: `collection-overview-${i}.csv`,
            mimeType: "text/csv",
            buffer: makeCsv(i * 2),
          },
          resolution: "32",
        },
        timeout: 120_000,
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json() as { savedDatasetId: string };
      datasetIds.push(body.savedDatasetId);
    }

    const created = await request.post(apiUrl("/api/user/collections"), {
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      data: { name: `Overview navigation ${Date.now()}` },
    });
    expect(created.ok()).toBeTruthy();
    collectionId = (await created.json() as { id: string }).id;
    for (const datasetId of datasetIds) {
      const added = await request.post(apiUrl(`/api/user/collections/${collectionId}/members`), {
        headers: { ...AUTH_HEADERS, "content-type": "application/json" },
        data: { datasetId },
      });
      expect(added.ok()).toBeTruthy();
    }

    await page.addInitScript(() => {
      sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
    });
    await page.goto("/");
    await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`btn-load-collection-${collectionId}`).click();
    await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      ({ id, members }) => {
        const scope = window.__bathyTest?.getCollectionScope?.();
        return scope?.collectionId === id &&
          scope.datasetIds?.length === members.length &&
          members.every((member) => scope.loadedDatasetIds.includes(member)) &&
          scope.fullTerrainDatasetIds.length === 0;
      },
      { id: collectionId, members: datasetIds },
      { timeout: 20_000 },
    );

    const targetId = datasetIds[2];
    const point = await page.evaluate((id) => {
      const snapshot = window.__bathyTest?.getCollectionOverviewSnapshot?.();
      const tile = snapshot?.tiles.find((candidate) => candidate.datasetId === id);
      if (!snapshot || !tile) return null;
      const lon = (tile.minLon + tile.maxLon) / 2;
      const lat = (tile.minLat + tile.maxLat) / 2;
      return {
        x: snapshot.transform.offsetX +
          (lon - snapshot.worldGrid.minLon) * snapshot.transform.pxPerDeg * snapshot.transform.scale,
        y: snapshot.transform.offsetY +
          (snapshot.worldGrid.maxLat - lat) * snapshot.transform.pxPerDeg * snapshot.transform.scale,
      };
    }, targetId);
    expect(point).not.toBeNull();

    const canvas = overviewMapCanvas(page);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await canvas.dispatchEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: box!.x + point!.x,
      clientY: box!.y + point!.y,
    });

    await expect(page.locator(".overview-map-header")).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => page.evaluate((id) => {
      const scope = window.__bathyTest?.getCollectionScope?.();
      return scope?.primaryDatasetId === id &&
        scope.fullTerrainDatasetIds.includes(id) &&
        window.__bathyTest?.getPendingDropIn?.() !== null;
    }, targetId)).toBe(true);
  } finally {
    if (collectionId) {
      await request.delete(apiUrl(`/api/user/collections/${collectionId}`), {
        headers: AUTH_HEADERS,
      }).catch(() => {});
    }
    for (const datasetId of datasetIds) {
      await request.delete(apiUrl(`/api/user/datasets/${datasetId}`), {
        headers: AUTH_HEADERS,
      }).catch(() => {});
    }
  }
});