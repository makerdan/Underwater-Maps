import { test, expect, type Page, type Route } from "./fixtures";

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

async function installCollectionRoutes(page: Page): Promise<CollectionFixture[]> {
  const collections: CollectionFixture[] = [
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
          () => window.__bathyTest?.getTerrainSummary?.()?.datasetId ?? null,
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
});