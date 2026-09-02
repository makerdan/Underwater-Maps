import { test, expect, apiUrl, E2E_USER_ID, type APIRequestContext, type Page, type Route } from "./fixtures";

type MemberKind = "dataset" | "catalogSave";

type CollectionMember = {
  id: string;
  kind: MemberKind;
  refId: string;
  name: string;
  createdAt: string;
};

type CollectionFixture = {
  id: string;
  name: string;
  collectionKind: "standard" | "special";
  specialMeta?: {
    bgImageKey: null;
    bgOpacity: number;
    bgGeoAnchors: null;
    layoutRevisions: [];
    activeRevisionId: null;
  };
  defaultMemberId: string | null;
  members: CollectionMember[];
  createdAt: string;
  updatedAt: string;
};

type LiveCollection = {
  id: string;
  defaultMemberId: string | null;
  members: Array<{
    id: string;
    kind: MemberKind;
    refId: string;
    name: string;
  }>;
};

type LiveCatalogSave = {
  id: string;
  catalogId: string;
  status: "queued" | "processing" | "ready" | "failed";
  datasetId: string | null;
  errorMessage: string | null;
};

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const STANDARD_COLLECTION_ID = "collection-upload-defaults";
const SPECIAL_COLLECTION_ID = "collection-catalog-defaults";
const UPLOAD_DATASET_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "11111111-1111-4111-8111-111111111112",
] as const;
const CATALOG_SAVE_IDS = ["catalog-save-default-first", "catalog-save-default-second"] as const;
const CATALOG_DATASET_IDS = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
] as const;

const AUTH_HEADERS = {
  "x-e2e-user-id": E2E_USER_ID,
  "x-e2e-bypass-secret": "e2e-playwright-secret",
};

function member(
  id: string,
  kind: MemberKind,
  refId: string,
  name: string,
): CollectionMember {
  return { id, kind, refId, name, createdAt: CREATED_AT };
}

function terrain(datasetId: string) {
  return {
    datasetId,
    name: datasetId,
    waterType: "saltwater",
    resolution: 2,
    width: 2,
    height: 2,
    depths: [1, 2, 3, 4],
    minDepth: 1,
    maxDepth: 4,
    minLon: -1,
    maxLon: 1,
    minLat: -1,
    maxLat: 1,
    centerLon: 0,
    centerLat: 0,
  };
}

function makeLiveCsv(minLon: number, minLat: number): Buffer {
  const rows = ["lon,lat,depth"];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      rows.push(`${minLon + x / 63},${minLat + y / 63},${100 + x + y}`);
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

async function getLiveCollection(
  request: APIRequestContext,
  collectionId: string,
): Promise<LiveCollection> {
  const response = await request.get(apiUrl("/api/user/collections"), {
    headers: AUTH_HEADERS,
  });
  expect(
    response.ok(),
    `listing live collections failed with ${response.status()}`,
  ).toBeTruthy();
  const collections = (await response.json()) as LiveCollection[];
  const collection = collections.find((item) => item.id === collectionId);
  expect(
    collection,
    `live collection ${collectionId} was not returned`,
  ).toBeDefined();
  return collection!;
}

async function createReadyCatalogSave(
  request: APIRequestContext,
  requestBbox: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  },
): Promise<LiveCatalogSave> {
  const response = await request.post(
    apiUrl("/api/datasets/catalog/preset-lake-ray-roberts/save"),
    {
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      data: { requestBbox },
      timeout: 30_000,
    },
  );
  expect(
    response.status(),
    `catalog save creation failed with ${response.status()}`,
  ).toBe(201);
  const created = (await response.json()) as { id?: string };
  expect(created.id, "catalog save creation did not return an id").toBeTruthy();

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const statusResponse = await request.get(
      apiUrl(`/api/datasets/my-saves/${created.id}/status`),
      { headers: AUTH_HEADERS },
    );
    expect(
      statusResponse.ok(),
      `catalog save status failed with ${statusResponse.status()}`,
    ).toBeTruthy();
    const save = (await statusResponse.json()) as LiveCatalogSave;
    if (save.status === "ready") {
      expect(save.datasetId, `catalog save ${created.id} has no dataset`).toBeTruthy();
      return save;
    }
    if (save.status === "failed") {
      throw new Error(
        `catalog save ${created.id} failed: ${save.errorMessage ?? "unknown error"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`catalog save ${created.id} did not become ready within 120 seconds`);
}

function createCollectionFixtures(): CollectionFixture[] {
  return [
    {
      id: STANDARD_COLLECTION_ID,
      name: "Uploaded defaults",
      collectionKind: "standard",
      defaultMemberId: null,
      members: [
        member("upload-member-first", "dataset", UPLOAD_DATASET_IDS[0], "Upload first"),
        member("upload-member-second", "dataset", UPLOAD_DATASET_IDS[1], "Upload second"),
      ],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    {
      id: SPECIAL_COLLECTION_ID,
      name: "Catalog defaults",
      collectionKind: "special",
      specialMeta: {
        bgImageKey: null,
        bgOpacity: 0.5,
        bgGeoAnchors: null,
        layoutRevisions: [],
        activeRevisionId: null,
      },
      defaultMemberId: null,
      members: [
        member("catalog-member-first", "catalogSave", CATALOG_SAVE_IDS[0], "Catalog first"),
        member("catalog-member-second", "catalogSave", CATALOG_SAVE_IDS[1], "Catalog second"),
      ],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ];
}

async function installCollectionRoutes(
  page: Page,
  collections = createCollectionFixtures(),
): Promise<CollectionFixture[]> {
  await page.route("**/api/user/collections", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname.endsWith("/api/user/collections")) {
      await route.fulfill({ status: 200, json: collections });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/user/collections/*/meta", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const match = pathname.match(/\/api\/user\/collections\/([^/]+)\/meta$/);
    if (request.method() === "PATCH" && match) {
      const collection = collections.find((item) => item.id === match[1]);
      if (!collection) {
        await route.fulfill({ status: 404, json: { error: "not_found" } });
        return;
      }
      const body = request.postDataJSON() as { defaultMemberId?: string | null };
      if (body.defaultMemberId !== undefined) {
        collection.defaultMemberId = body.defaultMemberId;
        collection.updatedAt = new Date().toISOString();
      }
      await route.fulfill({ status: 200, json: collection });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/user/collections/*/members/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const match = pathname.match(/\/api\/user\/collections\/([^/]+)\/members\/([^/]+)$/);
    if (request.method() === "DELETE" && match) {
      const collection = collections.find((item) => item.id === match[1]);
      if (!collection) {
        await route.fulfill({ status: 404, json: { error: "not_found" } });
        return;
      }
      const memberId = match[2];
      const memberIndex = collection.members.findIndex((member) => member.id === memberId);
      if (memberIndex < 0) {
        await route.fulfill({ status: 404, json: { error: "not_found" } });
        return;
      }
      collection.members.splice(memberIndex, 1);
      if (collection.defaultMemberId === memberId) collection.defaultMemberId = null;
      collection.updatedAt = new Date().toISOString();
      await route.fulfill({ status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/api/user/datasets", (route) =>
    route.fulfill({
      status: 200,
      json: UPLOAD_DATASET_IDS.map((id, index) => ({
        id,
        name: `Upload ${index === 0 ? "first" : "second"}`,
        minDepth: 1,
        maxDepth: 4,
        createdAt: CREATED_AT,
      })),
    }),
  );

  await page.route("**/api/datasets/my-saves*", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      json: CATALOG_SAVE_IDS.map((id, index) => ({
        id,
        catalogId: `catalog-entry-${index + 1}`,
        status: "ready",
        requestedAt: CREATED_AT,
        readyAt: CREATED_AT,
        displayLabel: `Catalog ${index === 0 ? "first" : "second"}`,
        datasetId: CATALOG_DATASET_IDS[index],
      })),
    });
  });

  const fulfillTerrain = async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const datasetId = pathname.split("/").at(-2);
    if (!datasetId) {
      await route.fulfill({ status: 404, json: { error: "not_found" } });
      return;
    }
    await route.fulfill({ status: 200, json: terrain(datasetId) });
  };
  await page.route("**/api/user/datasets/*/terrain", fulfillTerrain);
  await page.route("**/api/user/datasets/*/overview", fulfillTerrain);

  return collections;
}

async function chooseDefault(
  page: Page,
  collectionId: string,
  memberId: string,
): Promise<void> {
  await page.getByTestId(`btn-collection-settings-${collectionId}`).click();
  const selector = page.getByTestId(`select-collection-default-${collectionId}`);
  await expect(selector).toBeVisible();
  await selector.selectOption(memberId);
  await expect(page.getByTestId(`collection-default-save-status-${collectionId}`)).toHaveText(
    "Default dataset saved.",
  );
  await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click({ force: true });
}

async function expectDefault(
  page: Page,
  collectionId: string,
  memberId: string,
): Promise<void> {
  await page.getByTestId(`btn-collection-settings-${collectionId}`).click();
  await expect(page.getByTestId(`select-collection-default-${collectionId}`)).toHaveValue(
    memberId,
  );
  await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click({ force: true });
}

async function removeMember(page: Page, collectionId: string, memberId: string): Promise<void> {
  await page.getByTestId(`btn-expand-collection-${collectionId}`).click();
  await page.getByTestId(`btn-remove-member-${memberId}`).click();
  await expect(page.getByTestId(`collection-member-${memberId}`)).toBeHidden();
}

async function expectPrimaryDataset(page: Page, datasetId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => {
            const testApi = window.__bathyTest;
            return (
              testApi?.getTerrainSummary?.()?.datasetId ??
              testApi?.getCollectionScope?.().primaryDatasetId ??
              null
            );
          },
        ),
      { timeout: 10_000 },
    )
    .toBe(datasetId);
}

async function closeOverview(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__bathyTest?.setOverviewOpen?.(false);
  });
  await expect(page.locator(".overview-map-header")).toBeHidden({ timeout: 5_000 });
}

async function expectPuzzleMode(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.()?.puzzleMode ?? false,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("collection default member reload persistence", () => {
  test("restores uploaded Explore and catalog-save Puzzle defaults, then clears to automatic", async ({
    page,
  }) => {
    await installCollectionRoutes(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });

    await chooseDefault(page, STANDARD_COLLECTION_ID, "upload-member-second");
    await chooseDefault(page, SPECIAL_COLLECTION_ID, "catalog-member-second");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
    await expectDefault(page, STANDARD_COLLECTION_ID, "upload-member-second");
    await expectDefault(page, SPECIAL_COLLECTION_ID, "catalog-member-second");

    await page.getByTestId(`btn-load-collection-${STANDARD_COLLECTION_ID}`).click();
    await expectPrimaryDataset(page, UPLOAD_DATASET_IDS[1]);

    await page.getByTestId(`btn-activate-collection-${SPECIAL_COLLECTION_ID}`).click();
    await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 10_000 });
    await expectPuzzleMode(page);
    await expectPrimaryDataset(page, CATALOG_DATASET_IDS[1]);
    await closeOverview(page);

    await removeMember(page, STANDARD_COLLECTION_ID, "upload-member-second");
    await removeMember(page, SPECIAL_COLLECTION_ID, "catalog-member-second");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
    await expectDefault(page, STANDARD_COLLECTION_ID, "");
    await expectDefault(page, SPECIAL_COLLECTION_ID, "");

    await page.getByTestId(`btn-load-collection-${STANDARD_COLLECTION_ID}`).click();
    await expectPrimaryDataset(page, UPLOAD_DATASET_IDS[0]);

    await page.getByTestId(`btn-activate-collection-${SPECIAL_COLLECTION_ID}`).click();
    await expect(page.locator(".overview-map-header")).toBeVisible({ timeout: 10_000 });
    await expectPuzzleMode(page);
    await expectPrimaryDataset(page, CATALOG_DATASET_IDS[0]);
  });

  test("clears a removed live default in the API and reloads to the first member", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    let collectionId: string | null = null;
    const uploadedDatasetIds: string[] = [];

    try {
      const upload = async (
        name: string,
        minLon: number,
        minLat: number,
      ): Promise<string> => {
        const response = await request.post(apiUrl("/api/datasets/upload"), {
          headers: AUTH_HEADERS,
          multipart: {
            file: {
              name,
              mimeType: "text/csv",
              buffer: makeLiveCsv(minLon, minLat),
            },
            resolution: "64",
          },
          timeout: 120_000,
        });
        expect(
          response.ok(),
          `upload ${name} failed with ${response.status()}`,
        ).toBeTruthy();
        const body = (await response.json()) as { savedDatasetId?: string };
        expect(
          body.savedDatasetId,
          `upload ${name} did not return a saved dataset`,
        ).toBeTruthy();
        const datasetId = body.savedDatasetId!;
        uploadedDatasetIds.push(datasetId);
        return datasetId;
      };

      const firstDatasetId = await upload(
        `collection-default-first-${Date.now()}.csv`,
        0,
        0,
      );
      const secondDatasetId = await upload(
        `collection-default-second-${Date.now()}.csv`,
        2,
        2,
      );

      const createResponse = await request.post(
        apiUrl("/api/user/collections"),
        {
          headers: { ...AUTH_HEADERS, "content-type": "application/json" },
          data: { name: `Live default reload ${Date.now()}` },
        },
      );
      expect(
        createResponse.ok(),
        `collection creation failed with ${createResponse.status()}`,
      ).toBeTruthy();
      const createdCollection = (await createResponse.json()) as {
        id?: string;
      };
      expect(createdCollection.id).toBeTruthy();
      collectionId = createdCollection.id!;

      const addMember = async (datasetId: string) => {
        const response = await request.post(
          apiUrl(`/api/user/collections/${collectionId}/members`),
          {
            headers: { ...AUTH_HEADERS, "content-type": "application/json" },
            data: { datasetId },
          },
        );
        expect(
          response.ok(),
          `adding ${datasetId} to collection failed with ${response.status()}`,
        ).toBeTruthy();
        const body = (await response.json()) as { id?: string };
        expect(body.id).toBeTruthy();
        return body.id!;
      };

      const firstMemberId = await addMember(firstDatasetId);
      const secondMemberId = await addMember(secondDatasetId);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("collections-section")).toBeVisible({
        timeout: 12_000,
      });
      await expect(
        page.getByTestId(`btn-collection-settings-${collectionId}`),
      ).toBeVisible({ timeout: 12_000 });

      await chooseDefault(page, collectionId, secondMemberId);
      const selected = await getLiveCollection(request, collectionId);
      expect(selected.defaultMemberId).toBe(secondMemberId);
      expect(selected.members.map((member) => member.id)).toEqual([
        firstMemberId,
        secondMemberId,
      ]);

      await page.getByTestId(`btn-expand-collection-${collectionId}`).click();
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response
            .url()
            .includes(
              `/api/user/collections/${collectionId}/members/${secondMemberId}`,
            ),
      );
      await page.getByTestId(`btn-remove-member-${secondMemberId}`).click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(204);
      await expect(
        page.getByTestId(`collection-member-${secondMemberId}`),
      ).toBeHidden();

      const removed = await getLiveCollection(request, collectionId);
      expect(removed.defaultMemberId).toBeNull();
      expect(removed.members.map((member) => member.id)).toEqual([
        firstMemberId,
      ]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("collections-section")).toBeVisible({
        timeout: 12_000,
      });
      await expect(
        page.getByTestId(`btn-collection-settings-${collectionId}`),
      ).toBeVisible({ timeout: 12_000 });
      await expectDefault(page, collectionId, "");

      const finalCollection = await getLiveCollection(request, collectionId);
      expect(finalCollection.defaultMemberId).toBeNull();
      expect(finalCollection.members.map((member) => member.refId)).toEqual([
        firstDatasetId,
      ]);

      await page.getByTestId(`btn-load-collection-${collectionId}`).click();
      await expectPrimaryDataset(page, firstDatasetId);
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), {
            headers: AUTH_HEADERS,
          })
          .catch(() => {});
      }
      for (const datasetId of uploadedDatasetIds) {
        await request
          .delete(apiUrl(`/api/user/datasets/${datasetId}`), {
            headers: AUTH_HEADERS,
          })
          .catch(() => {});
      }
    }
  });

  test("clears a removed live catalog default and reloads to the first catalog member", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);

    let collectionId: string | null = null;
    const catalogSaveIds: string[] = [];

    try {
      // Distinct request bboxes allow the same real catalog entry to be
      // materialized twice. The preset materializer serves the bundled grid,
      // so these small bbox changes only make the save rows distinct while
      // keeping the setup deterministic and offline from upstream services.
      const offset = (Date.now() % 1000) / 1_000_000;
      const firstSave = await createReadyCatalogSave(request, {
        minLon: -97.15 + offset,
        minLat: 33.3,
        maxLon: -97.14 + offset,
        maxLat: 33.31,
      });
      catalogSaveIds.push(firstSave.id);
      const secondSave = await createReadyCatalogSave(request, {
        minLon: -97.13 + offset,
        minLat: 33.32,
        maxLon: -97.12 + offset,
        maxLat: 33.33,
      });
      catalogSaveIds.push(secondSave.id);
      expect(firstSave.datasetId).toBeTruthy();
      expect(secondSave.datasetId).toBeTruthy();

      const createResponse = await request.post(apiUrl("/api/user/collections"), {
        headers: { ...AUTH_HEADERS, "content-type": "application/json" },
        data: { name: `Live catalog default reload ${Date.now()}` },
      });
      expect(
        createResponse.ok(),
        `catalog collection creation failed with ${createResponse.status()}`,
      ).toBeTruthy();
      const createdCollection = (await createResponse.json()) as { id?: string };
      expect(createdCollection.id).toBeTruthy();
      collectionId = createdCollection.id!;

      const addCatalogSave = async (catalogSaveId: string) => {
        const response = await request.post(
          apiUrl(`/api/user/collections/${collectionId}/members`),
          {
            headers: { ...AUTH_HEADERS, "content-type": "application/json" },
            data: { catalogSaveId },
          },
        );
        expect(
          response.ok(),
          `adding catalog save ${catalogSaveId} failed with ${response.status()}`,
        ).toBeTruthy();
        const body = (await response.json()) as { id?: string };
        expect(body.id).toBeTruthy();
        return body.id!;
      };

      const firstMemberId = await addCatalogSave(firstSave.id);
      const secondMemberId = await addCatalogSave(secondSave.id);

      const seeded = await getLiveCollection(request, collectionId);
      expect(seeded.members.map((member) => member.kind)).toEqual([
        "catalogSave",
        "catalogSave",
      ]);
      expect(seeded.members.map((member) => member.refId)).toEqual([
        firstSave.id,
        secondSave.id,
      ]);

      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("collections-section")).toBeVisible({
        timeout: 12_000,
      });
      await expect(
        page.getByTestId(`btn-collection-settings-${collectionId}`),
      ).toBeVisible({ timeout: 12_000 });

      await chooseDefault(page, collectionId, secondMemberId);
      const selected = await getLiveCollection(request, collectionId);
      expect(selected.defaultMemberId).toBe(secondMemberId);

      await page.getByTestId(`btn-expand-collection-${collectionId}`).click();
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response
            .url()
            .includes(
              `/api/user/collections/${collectionId}/members/${secondMemberId}`,
            ),
      );
      await page.getByTestId(`btn-remove-member-${secondMemberId}`).click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(204);
      await expect(
        page.getByTestId(`collection-member-${secondMemberId}`),
      ).toBeHidden();

      const removed = await getLiveCollection(request, collectionId);
      expect(removed.defaultMemberId).toBeNull();
      expect(removed.members.map((member) => member.refId)).toEqual([firstSave.id]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("collections-section")).toBeVisible({
        timeout: 12_000,
      });
      await expect(
        page.getByTestId(`btn-collection-settings-${collectionId}`),
      ).toBeVisible({ timeout: 12_000 });
      await expectDefault(page, collectionId, "");

      const finalCollection = await getLiveCollection(request, collectionId);
      expect(finalCollection.defaultMemberId).toBeNull();
      expect(finalCollection.members).toHaveLength(1);
      expect(finalCollection.members[0]?.refId).toBe(firstSave.id);

      await page.getByTestId(`btn-load-collection-${collectionId}`).click();
      await expectPrimaryDataset(page, firstSave.datasetId!);
    } finally {
      if (collectionId) {
        await request
          .delete(apiUrl(`/api/user/collections/${collectionId}`), {
            headers: AUTH_HEADERS,
          })
          .catch(() => {});
      }
      for (const saveId of catalogSaveIds) {
        await request
          .delete(apiUrl(`/api/datasets/my-saves/${saveId}`), {
            headers: AUTH_HEADERS,
          })
          .catch(() => {});
      }
    }
  });

  test("refreshes another open browser session after removing its selected default", async ({
    page,
    browser,
  }) => {
    const collections = await installCollectionRoutes(page);
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.addInitScript(() => {
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } =
          raw ? JSON.parse(raw) : {};
        parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {
        localStorage.setItem(
          "bathyscan:settings",
          JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }),
        );
      }
    });
    await installCollectionRoutes(secondPage, collections);

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await secondPage.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await expect(secondPage.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });

      await chooseDefault(page, SPECIAL_COLLECTION_ID, "catalog-member-second");
      await secondPage.getByTestId(`btn-collection-settings-${SPECIAL_COLLECTION_ID}`).click();
      await expect(
        secondPage.getByTestId(`select-collection-default-${SPECIAL_COLLECTION_ID}`),
      ).toHaveValue("catalog-member-second");

      await removeMember(page, SPECIAL_COLLECTION_ID, "catalog-member-second");

      // The row and its already-open settings sheet must update from polling,
      // not from a reload or a writer-side cache update.
      await expect(secondPage.getByTestId(`collection-row-${SPECIAL_COLLECTION_ID}`)).toContainText(
        "(1)",
      );
      await expect(
        secondPage.getByTestId(`select-collection-default-${SPECIAL_COLLECTION_ID}`),
      ).toHaveValue("");
      await expect(
        secondPage.getByTestId(`collection-member-catalog-member-second`),
      ).toBeHidden();

      await secondPage
        .getByTestId(`btn-close-collection-settings-${SPECIAL_COLLECTION_ID}`)
        .click({ force: true });
      await secondPage
        .getByTestId(`btn-activate-collection-${SPECIAL_COLLECTION_ID}`)
        .click();
      await expect(secondPage.locator(".overview-map-header")).toBeVisible({ timeout: 10_000 });
      await expectPuzzleMode(secondPage);
      await expectPrimaryDataset(secondPage, CATALOG_DATASET_IDS[0]);
    } finally {
      await secondContext.close();
    }
  });
});
