import { test, expect, apiUrl, E2E_USER_ID } from "./fixtures";
import { overviewMapCanvas } from "./_helpers/canvases";

const AUTH_HEADERS = {
  "x-e2e-user-id": E2E_USER_ID,
  "x-e2e-bypass-secret": "e2e-playwright-secret",
};

type UploadResponse = { savedDatasetId?: string };

function makeCsv(minLon: number, minLat: number): Buffer {
  const rows = ["lon,lat,depth"];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      rows.push(`${minLon + x / 63},${minLat + y / 63},${100 + x + y}`);
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

test.describe("Special collection GAPS coverage", () => {
  test("activates all ready members and paints the gap/overlap overlay", async ({
    page,
    request,
  }) => {
    let collectionId: string | null = null;
    const uploadedDatasetIds: string[] = [];
    try {
      const upload = async (name: string, minLon: number, minLat: number): Promise<string> => {
        const response = await request.post(apiUrl("/api/datasets/upload"), {
          headers: AUTH_HEADERS,
          multipart: {
            file: { name, mimeType: "text/csv", buffer: makeCsv(minLon, minLat) },
            resolution: "64",
          },
          timeout: 120_000,
        });
        expect(response.ok(), `upload ${name} failed with ${response.status()}`).toBeTruthy();
        const body = (await response.json()) as UploadResponse;
        expect(body.savedDatasetId).toBeTruthy();
        const id = body.savedDatasetId!;
        uploadedDatasetIds.push(id);
        return id;
      };
      const members = [
        await upload("gaps-a.csv", 0, 0),
        await upload("gaps-b.csv", 2, 2),
      ];

      const createResponse = await request.post(apiUrl("/api/user/collections"), {
        headers: { ...AUTH_HEADERS, "content-type": "application/json" },
        data: { name: `Gaps coverage ${Date.now()}`, collectionKind: "special" },
      });
      expect(createResponse.ok()).toBeTruthy();
      const collection = (await createResponse.json()) as { id: string };
      collectionId = collection.id;
      const activeCollectionId = collection.id;

      for (const datasetId of members) {
        const addResponse = await request.post(
          apiUrl(`/api/user/collections/${activeCollectionId}/members`),
          {
            headers: { ...AUTH_HEADERS, "content-type": "application/json" },
            data: { datasetId },
          },
        );
        expect(addResponse.ok()).toBeTruthy();
      }

      await page.addInitScript(() => {
        try {
          sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true");
        } catch {}
      });
      await page.goto("/");
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await page.getByTestId(`btn-activate-collection-${activeCollectionId}`).click();

      await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 15_000 });
      await page.waitForFunction(
        (expected: { collectionId: string; memberIds: string[] }) => {
          const scope = window.__bathyTest?.getCollectionScope?.();
          return scope?.collectionId === expected.collectionId &&
            scope.datasetIds?.length === 2 &&
            scope.datasetIds.every((id) => expected.memberIds.includes(id)) &&
            expected.memberIds.every((id) => scope.loadedDatasetIds.includes(id));
        },
        { collectionId: activeCollectionId, memberIds: members },
        { timeout: 15_000 },
      );

      await page.getByTestId("overview-map-folder-puzzle").click();
      const gaps = page.getByTestId("overview-puzzle-gap-toggle");
      await expect(gaps).toBeVisible();
      const canvas = overviewMapCanvas(page);
      await expect(canvas).toBeVisible();
      const before = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
      await gaps.click();
      await expect(gaps).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(350);
      const after = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
      expect(after).not.toBe(before);
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
      for (const datasetId of uploadedDatasetIds) {
        await request
          .delete(apiUrl(`/api/user/datasets/${datasetId}`), { headers: AUTH_HEADERS })
          .catch(() => {});
      }
    }
  });
});