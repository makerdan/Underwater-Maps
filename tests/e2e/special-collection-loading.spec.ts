import {
  expect,
  test,
  apiUrl,
  E2E_USER_ID,
  type APIRequestContext,
  type Page,
  type Request,
} from "./fixtures";

const AUTH_HEADERS = {
  "x-e2e-user-id": E2E_USER_ID,
  "x-e2e-bypass-secret": "e2e-playwright-secret",
};

type CollectionFixture = {
  collectionId: string;
  datasetId: string;
};

type UploadResponse = {
  savedDatasetId?: string;
};

function makeCsv(minLon: number): Buffer {
  const rows = ["lon,lat,depth"];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      rows.push(`${minLon + x / 31},${y / 31},${80 + x + y}`);
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function createReadySpecialCollection(
  page: Page,
  request: APIRequestContext,
  name: string,
  minLon: number,
  collectionIds: string[],
  datasetIds: string[],
): Promise<CollectionFixture> {
  const uploaded = await request.post(apiUrl("/api/datasets/upload"), {
    headers: AUTH_HEADERS,
    multipart: {
      file: {
        name: `${name.replaceAll(" ", "-")}.csv`,
        mimeType: "text/csv",
        buffer: makeCsv(minLon),
      },
      resolution: "32",
    },
    timeout: 120_000,
  });
  expect(uploaded.ok(), `upload ${name} failed with ${uploaded.status()}`).toBeTruthy();
  const { savedDatasetId: datasetId } = (await uploaded.json()) as UploadResponse;
  expect(datasetId).toBeTruthy();
  datasetIds.push(datasetId!);

  await page.goto("/");
  await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
  await page.getByTestId("btn-new-collection").click();
  await page.getByTestId("input-new-collection").fill(name);
  await page.getByTestId("input-new-collection-special").check();
  await page.getByTestId("btn-create-collection").click();

  const settingsSheet = page.locator('[data-testid^="collection-settings-sheet-"]');
  await expect(settingsSheet).toBeVisible();
  const collectionId = await settingsSheet.getAttribute("data-testid").then((value) =>
    value?.replace("collection-settings-sheet-", "") ?? null,
  );
  if (!collectionId) throw new Error("Special collection settings did not expose a collection id.");
  collectionIds.push(collectionId);

  const added = await request.post(apiUrl(`/api/user/collections/${collectionId}/members`), {
    headers: { ...AUTH_HEADERS, "content-type": "application/json" },
    data: { datasetId },
  });
  expect(added.ok()).toBeTruthy();

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
  await page.getByTestId(`input-anchor-a-lon-${collectionId}`).fill(String(minLon));
  await page.getByTestId(`input-anchor-a-lat-${collectionId}`).fill("0.8");
  await page.getByTestId(`input-anchor-b-lon-${collectionId}`).fill(String(minLon + 1));
  await page.getByTestId(`input-anchor-b-lat-${collectionId}`).fill("-0.8");
  await expect(page.getByTestId(`btn-save-anchors-${collectionId}`)).toBeEnabled();
  await page.getByTestId(`btn-save-anchors-${collectionId}`).click();
  await expect(page.getByTestId(`anchor-save-status-${collectionId}`)).toContainText(
    "live reference image is now GPS-registered",
  );

  await page.getByTestId(`btn-close-collection-settings-${collectionId}`).click();
  // Confirm activation will read the server-confirmed image and anchors.
  await page.reload();
  await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
  return { collectionId, datasetId: datasetId! };
}

async function activateAndWaitForImage(page: Page, fixture: CollectionFixture): Promise<void> {
  await page.getByTestId(`btn-activate-collection-${fixture.collectionId}`).click();
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
    fixture,
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("overview-reference-image-loading")).toBeHidden();
}

function holdBackgroundRequest(
  page: Page,
  collectionId: string,
  outcome: "success" | "unavailable",
): {
  requested: Promise<Request>;
  release: () => void;
  removeRoute: () => Promise<void>;
} {
  const requestStarted = deferred<Request>();
  const responseGate = deferred<void>();
  const routePattern = `**/api/user/collections/${collectionId}/background`;

  const routeReady = page.route(routePattern, async (route) => {
    requestStarted.resolve(route.request());
    await responseGate.promise;
    if (outcome === "success") {
      await route.continue();
    } else {
      await route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Reference image unavailable",
      });
    }
  });

  return {
    requested: requestStarted.promise,
    release: () => responseGate.resolve(),
    removeRoute: async () => {
      await routeReady;
      await page.unroute(routePattern);
    },
  };
}

async function expectAuthenticatedRequest(request: Request): Promise<void> {
  const headers = request.headers();
  expect(headers["x-e2e-user-id"]).toBe(E2E_USER_ID);
  expect(headers["x-e2e-bypass-secret"]).toBe("e2e-playwright-secret");
}

async function expectNewScopeLoading(
  page: Page,
  previousCollectionId: string,
  next: CollectionFixture,
): Promise<void> {
  await page.waitForFunction(
    ({ collectionId }) => {
      const scope = window.__bathyTest?.getCollectionScope?.();
      const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
      return scope?.collectionId === collectionId && overlay === null;
    },
    { collectionId: next.collectionId },
    { timeout: 5_000 },
  );

  const loading = page.getByTestId("overview-reference-image-loading");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("role", "status");
  await expect(loading).toContainText("Loading reference image");

  const scope = await page.evaluate(() => ({
    overlay: window.__bathyTest?.getActiveSpecialCollectionOverlay?.() ?? null,
    collection: window.__bathyTest?.getCollectionScope?.() ?? null,
  }));
  expect(scope.collection?.collectionId).toBe(next.collectionId);
  expect(scope.collection?.collectionId).not.toBe(previousCollectionId);
  expect(scope.overlay).toBeNull();
}

async function cleanupCollections(
  request: APIRequestContext,
  collectionIds: string[],
  datasetIds: string[],
): Promise<void> {
  for (const id of collectionIds) {
    await request
      .delete(apiUrl(`/api/user/collections/${id}`), { headers: AUTH_HEADERS })
      .catch(() => {});
  }
  for (const id of datasetIds) {
    await request
      .delete(apiUrl(`/api/user/datasets/${id}`), { headers: AUTH_HEADERS })
      .catch(() => {});
  }
}

test.describe("Special collection reference-image loading", () => {
  test("keeps the new collection loading visible until its image succeeds", async ({
    page,
    request,
  }) => {
    const collectionIds: string[] = [];
    const datasetIds: string[] = [];
    let heldRequest: ReturnType<typeof holdBackgroundRequest> | null = null;

    try {
      const collectionA = await createReadySpecialCollection(
        page,
        request,
        `Loading success A ${Date.now()}`,
        -0.8,
        collectionIds,
        datasetIds,
      );
      const collectionB = await createReadySpecialCollection(
        page,
        request,
        `Loading success B ${Date.now()}`,
        3.2,
        collectionIds,
        datasetIds,
      );

      await page.goto("/");
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await activateAndWaitForImage(page, collectionA);

      heldRequest = holdBackgroundRequest(page, collectionB.collectionId, "success");
      await page.getByTestId(`btn-activate-collection-${collectionB.collectionId}`).click();
      await expectAuthenticatedRequest(await heldRequest.requested);
      await expectNewScopeLoading(page, collectionA.collectionId, collectionB);

      heldRequest.release();
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
        collectionB,
        { timeout: 20_000 },
      );
      await expect(page.getByTestId("overview-reference-image-loading")).toBeHidden();
      const overlay = await page.evaluate(
        () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.() ?? null,
      );
      expect(overlay?.collectionId).toBe(collectionB.collectionId);
      expect(overlay?.imageReady).toBe(true);
    } finally {
      if (heldRequest) {
        heldRequest.release();
        await heldRequest.removeRoute();
      }
      await cleanupCollections(request, collectionIds, datasetIds);
    }
  });

  test("clears the loading status without restoring the prior overlay when the image is unavailable", async ({
    page,
    request,
  }) => {
    const collectionIds: string[] = [];
    const datasetIds: string[] = [];
    let heldRequest: ReturnType<typeof holdBackgroundRequest> | null = null;

    try {
      const collectionA = await createReadySpecialCollection(
        page,
        request,
        `Loading unavailable A ${Date.now()}`,
        -0.8,
        collectionIds,
        datasetIds,
      );
      const collectionB = await createReadySpecialCollection(
        page,
        request,
        `Loading unavailable B ${Date.now()}`,
        3.2,
        collectionIds,
        datasetIds,
      );

      await page.goto("/");
      await expect(page.getByTestId("collections-section")).toBeVisible({ timeout: 12_000 });
      await activateAndWaitForImage(page, collectionA);

      heldRequest = holdBackgroundRequest(page, collectionB.collectionId, "unavailable");
      await page.getByTestId(`btn-activate-collection-${collectionB.collectionId}`).click();
      await expectAuthenticatedRequest(await heldRequest.requested);
      await expectNewScopeLoading(page, collectionA.collectionId, collectionB);

      heldRequest.release();
      await expect(page.getByTestId("overview-reference-image-loading")).toBeHidden({
        timeout: 10_000,
      });
      await page.waitForFunction(
        ({ collectionId }) => {
          const overlay = window.__bathyTest?.getActiveSpecialCollectionOverlay?.();
          const scope = window.__bathyTest?.getCollectionScope?.();
          return (
            scope?.collectionId === collectionId &&
            overlay?.collectionId === collectionId &&
            overlay.imageReady === false
          );
        },
        { collectionId: collectionB.collectionId },
        { timeout: 10_000 },
      );

      const overlay = await page.evaluate(
        () => window.__bathyTest?.getActiveSpecialCollectionOverlay?.() ?? null,
      );
      expect(overlay?.collectionId).toBe(collectionB.collectionId);
      expect(overlay?.collectionId).not.toBe(collectionA.collectionId);
      expect(overlay?.imageReady).toBe(false);
    } finally {
      if (heldRequest) {
        heldRequest.release();
        await heldRequest.removeRoute();
      }
      await cleanupCollections(request, collectionIds, datasetIds);
    }
  });
});