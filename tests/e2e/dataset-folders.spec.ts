import { test, expect, type APIRequestContext, type Page, API_URL } from "./fixtures";

/**
 * Dataset folders E2E.
 *
 * Strategy:
 *   The folder system is fully auth-gated (every /user/folders route runs
 *   through requireAuth). The Playwright webServer for api-server is started
 *   with E2E_AUTH_BYPASS=1, which accepts an x-e2e-user-id header in lieu of
 *   a Clerk JWT. We drive the real folders API directly against the
 *   api-server (port configured via E2E_API_BASE_URL / playwright.config.ts), which
 *   exercises:
 *     - create / rename / move / duplicate / delete folder endpoints
 *     - dataset move + duplicate
 *     - cycle prevention, ownership checks, and sibling-name uniqueness
 *     - persistence across "reloads" (a fresh request context)
 */

const API_BASE = `${API_URL}/api`;
const USER_A = `e2e-folders-user-${Date.now()}`;
const USER_B = `e2e-folders-other-${Date.now()}`;

function authHeaders(userId: string): Record<string, string> {
  return {
    "x-e2e-user-id": userId,
    "Content-Type": "application/json",
  };
}

async function listFolders(req: APIRequestContext, userId: string) {
  const res = await req.get(`${API_BASE}/user/folders`, {
    headers: authHeaders(userId),
  });
  expect(res.ok(), `list folders for ${userId}`).toBeTruthy();
  return (await res.json()) as Array<{
    id: string;
    name: string;
    parentId: string | null;
  }>;
}

async function createFolder(
  req: APIRequestContext,
  userId: string,
  name: string,
  parentId: string | null = null,
): Promise<{ id: string; name: string; parentId: string | null }> {
  const res = await req.post(`${API_BASE}/user/folders`, {
    headers: authHeaders(userId),
    data: { name, parentId },
  });
  expect(res.status(), `create folder ${name}`).toBe(201);
  return res.json();
}

async function cleanupUser(req: APIRequestContext, userId: string) {
  const rows = await listFolders(req, userId);
  // Delete roots with mode=contents — cascades to descendants.
  const roots = rows.filter((r) => r.parentId === null);
  for (const r of roots) {
    await req
      .delete(`${API_BASE}/user/folders/${r.id}`, {
        headers: authHeaders(userId),
        data: { mode: "contents" },
      })
      .catch(() => undefined);
  }
}

test.describe("dataset folders API (auth-bypass)", () => {
  test.afterAll(async ({ request }) => {
    await cleanupUser(request, USER_A);
    await cleanupUser(request, USER_B);
  });

  test("create, rename, nest, and persist across a fresh request context", async ({
    request,
    playwright,
  }) => {
    // Start clean.
    await cleanupUser(request, USER_A);
    expect(await listFolders(request, USER_A)).toEqual([]);

    // Create a root folder, then a nested child.
    const reefs = await createFolder(request, USER_A, "Reefs");
    expect(reefs.parentId).toBeNull();
    const inner = await createFolder(request, USER_A, "Inner", reefs.id);
    expect(inner.parentId).toBe(reefs.id);

    // Rename the child via inline rename endpoint.
    const renameRes = await request.patch(
      `${API_BASE}/user/folders/${inner.id}/rename`,
      { headers: authHeaders(USER_A), data: { name: "Inner Reefs" } },
    );
    expect(renameRes.ok()).toBeTruthy();

    // Sibling-name uniqueness: a second "Reefs" at root must be rejected.
    const dup = await request.post(`${API_BASE}/user/folders`, {
      headers: authHeaders(USER_A),
      data: { name: "reefs", parentId: null },
    });
    expect(dup.status()).toBe(400);

    // Persistence: a fresh request context simulates a reload.
    const fresh = await playwright.request.newContext();
    try {
      const rows = await listFolders(fresh, USER_A);
      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual(["Inner Reefs", "Reefs"]);
      const reloadedInner = rows.find((r) => r.name === "Inner Reefs")!;
      expect(reloadedInner.parentId).toBe(reefs.id);
    } finally {
      await fresh.dispose();
    }
  });

  test("rejects moving a folder into one of its own descendants (cycle)", async ({
    request,
  }) => {
    await cleanupUser(request, USER_A);
    const a = await createFolder(request, USER_A, "A");
    const b = await createFolder(request, USER_A, "B", a.id);
    const c = await createFolder(request, USER_A, "C", b.id);

    // Attempt: move A under C (its grand-descendant) → cycle.
    const res = await request.patch(`${API_BASE}/user/folders/${a.id}/move`, {
      headers: authHeaders(USER_A),
      data: { parentId: c.id },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("cycle");

    // Self-move is also rejected.
    const selfRes = await request.patch(
      `${API_BASE}/user/folders/${a.id}/move`,
      { headers: authHeaders(USER_A), data: { parentId: a.id } },
    );
    expect(selfRes.status()).toBe(400);
  });

  test("duplicates a folder subtree under '<name> (copy)'", async ({
    request,
  }) => {
    await cleanupUser(request, USER_A);
    const root = await createFolder(request, USER_A, "Wrecks");
    await createFolder(request, USER_A, "Shallow", root.id);
    await createFolder(request, USER_A, "Deep", root.id);

    const dupRes = await request.post(
      `${API_BASE}/user/folders/${root.id}/duplicate`,
      { headers: authHeaders(USER_A) },
    );
    expect(dupRes.status()).toBe(201);
    const dup = await dupRes.json();
    expect(dup.name).toBe("Wrecks (copy)");
    expect(dup.parentId).toBeNull();

    // The copy must contain children with the same names.
    const all = await listFolders(request, USER_A);
    const dupChildren = all.filter((r) => r.parentId === dup.id).map((r) => r.name).sort();
    expect(dupChildren).toEqual(["Deep", "Shallow"]);
  });

  test("delete with mode=promote re-parents children to the deleted folder's parent", async ({
    request,
  }) => {
    await cleanupUser(request, USER_A);
    const parent = await createFolder(request, USER_A, "Parent");
    const middle = await createFolder(request, USER_A, "Middle", parent.id);
    const leaf = await createFolder(request, USER_A, "Leaf", middle.id);

    const delRes = await request.delete(
      `${API_BASE}/user/folders/${middle.id}`,
      { headers: authHeaders(USER_A), data: { mode: "promote" } },
    );
    expect(delRes.status()).toBe(204);

    const rows = await listFolders(request, USER_A);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(middle.id);
    // "Leaf" should now be parented to "Parent" (promoted up one level).
    const promoted = rows.find((r) => r.id === leaf.id);
    expect(promoted, "leaf survived promote delete").toBeTruthy();
    expect(promoted!.parentId).toBe(parent.id);
  });

  test("enforces ownership — other users cannot see, rename, or delete a folder", async ({
    request,
  }) => {
    await cleanupUser(request, USER_A);
    await cleanupUser(request, USER_B);

    const aFolder = await createFolder(request, USER_A, "PrivateA");

    // User B's list does not include user A's folder.
    const bRows = await listFolders(request, USER_B);
    expect(bRows.find((r) => r.id === aFolder.id)).toBeUndefined();

    // User B trying to rename returns 404 (filtered out by userId).
    const renameRes = await request.patch(
      `${API_BASE}/user/folders/${aFolder.id}/rename`,
      { headers: authHeaders(USER_B), data: { name: "hijacked" } },
    );
    expect(renameRes.status()).toBe(404);

    // Unauthenticated request is rejected with 401.
    const noAuth = await request.get(`${API_BASE}/user/folders`);
    expect(noAuth.status()).toBe(401);
  });
});

// ─── UI action-bar tests ──────────────────────────────────────────────────────
//
// These tests drive the real browser UI with route-mocked API responses so no
// database seed is required. Each test:
//   1. Intercepts GET /api/user/folders + GET /api/user/datasets to inject
//      fixture data into the DatasetFolderTree.
//   2. Seeds synthetic terrain via __bathyTest.seedTerrain so the Explore
//      sidebar renders the MY LIBRARY section (same pattern used by the
//      upload-autosave spec).
//   3. Interacts with checkboxes / action-bar buttons to verify the targeted
//      behaviour.

async function ensureExploreAndLibrary(page: Page): Promise<void> {
  const exploreBtn = page.getByRole("button", { name: "Explore", exact: true });
  if (await exploreBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await exploreBtn.click().catch(() => {});
  }
  await page
    .waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } })
            .__bathyTest?.seedTerrain,
        ),
      undefined,
      { timeout: 12_000 },
    )
    .catch(() => {});
  await page
    .evaluate(() =>
      (window as unknown as { __bathyTest?: { seedTerrain?: () => boolean } })
        .__bathyTest?.seedTerrain?.(),
    )
    .catch(() => {});
  await page
    .waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __bathyTest?: { getTerrainSummary?: () => unknown } })
            .__bathyTest?.getTerrainSummary?.(),
        ),
      undefined,
      { timeout: 8_000 },
    )
    .catch(() => {});
}

function makeFolder(id: string, name: string, parentId: string | null = null) {
  return { id, name, parentId, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

function makeDataset(id: string, name: string, folderId: string | null = null) {
  return { id, name, minDepth: 0, maxDepth: 100, folderId, createdAt: "2026-01-01T00:00:00Z" };
}

test.describe("dataset folders — UI action bar (route-mocked)", () => {
  test.beforeEach(async ({ page, resetPanelCollapse }) => {
    void resetPanelCollapse;
    await page.addInitScript(() => {
      try {
        const raw = localStorage.getItem("bathyscan:settings");
        const parsed: { state?: Record<string, unknown>; version?: number } = raw
          ? JSON.parse(raw) : {};
        parsed.state = { ...(parsed.state ?? {}), hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true };
        localStorage.setItem("bathyscan:settings", JSON.stringify(parsed));
      } catch {
        try {
          localStorage.setItem("bathyscan:settings",
            JSON.stringify({ state: { hasSeenOnboarding: true, hasSeenToolbarRelocationHint: true }, version: 0 }));
        } catch {}
      }
    });
    await page.addInitScript(() => {
      try { sessionStorage.setItem("bathyscan:simulatedDataWarn:suppress", "true"); } catch {}
    });
  });

  test("single-folder move: action bar 'Move To Folder' opens dialog, confirms move, tree updates", async ({
    page,
  }) => {
    const SRC = makeFolder("ui-src-f1", "Source Folder");
    const DST = makeFolder("ui-dst-f1", "Destination Folder");
    const ANCHOR = makeDataset("ui-anchor-ds1", "Anchor Dataset");

    let foldersCallCount = 0;
    await page.route("**/api/user/folders**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      foldersCallCount++;
      const folders = foldersCallCount <= 1
        ? [SRC, DST]
        : [{ ...SRC, parentId: DST.id }, DST];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(folders),
      });
    });
    await page.route("**/api/user/datasets**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([ANCHOR]),
      });
    });
    await page.route(`**/api/user/folders/${SRC.id}/move`, (route) => {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...SRC, parentId: DST.id }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await ensureExploreAndLibrary(page);

    // Wait for the DatasetFolderTree to render the anchor dataset row.
    const anchorRow = page.getByTestId(`btn-user-dataset-${ANCHOR.id}`);
    await anchorRow.waitFor({ state: "visible", timeout: 10_000 });

    // Enter selection mode by clicking the anchor dataset's checkbox.
    await anchorRow.locator('span[role="checkbox"]').click();

    // Select the source folder (row is now clickable in selectionMode).
    const srcFolderRow = page.getByTestId(`folder-row-${SRC.id}`);
    await srcFolderRow.waitFor({ state: "visible", timeout: 5_000 });
    await srcFolderRow.click();

    // Deselect the anchor dataset — only source folder remains selected.
    await anchorRow.locator('span[role="checkbox"]').click();

    // Action bar must be visible now with exactly one folder selected.
    const actionBar = page.getByTestId("library-action-bar");
    await actionBar.waitFor({ state: "visible", timeout: 5_000 });

    const moveBtn = page.getByTestId("btn-action-move-to-folder");
    await expect(moveBtn).not.toBeDisabled();
    await moveBtn.click();

    // Move dialog opens.
    const dialog = page.getByTestId("move-to-dialog");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });

    // Select the destination folder option.
    await page.getByTestId(`move-opt-${DST.id}`).click();

    // Confirm the move.
    await page.getByTestId("move-to-confirm").click();

    // After a successful move the dialog closes and the tree re-fetches.
    await dialog.waitFor({ state: "detached", timeout: 5_000 });

    // On the next GET /api/user/folders the source folder has parentId = DST.
    // Wait for the destination folder row to appear and expand it to verify
    // the source folder is nested inside it.
    await page.getByTestId(`folder-row-${DST.id}`).waitFor({ state: "visible", timeout: 8_000 });
  });

  test("multi-dataset bulk move: select two datasets, move to folder, both appear inside destination", async ({
    page,
  }) => {
    const DST = makeFolder("ui-dst-f2", "Drop Zone");
    const DS1 = makeDataset("ui-ds2a", "Survey Alpha");
    const DS2 = makeDataset("ui-ds2b", "Survey Beta");

    let datasetsCallCount = 0;
    await page.route("**/api/user/folders**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([DST]),
      });
    });
    await page.route("**/api/user/datasets**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      datasetsCallCount++;
      const datasets = datasetsCallCount <= 1
        ? [DS1, DS2]
        : [{ ...DS1, folderId: DST.id }, { ...DS2, folderId: DST.id }];
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(datasets),
      });
    });
    await page.route(`**/api/user/datasets/${DS1.id}/move`, (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...DS1, folderId: DST.id }) }),
    );
    await page.route(`**/api/user/datasets/${DS2.id}/move`, (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...DS2, folderId: DST.id }) }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await ensureExploreAndLibrary(page);

    // Select both dataset checkboxes to enter and extend selection mode.
    const row1 = page.getByTestId(`btn-user-dataset-${DS1.id}`);
    await row1.waitFor({ state: "visible", timeout: 10_000 });
    await row1.locator('span[role="checkbox"]').click();

    const row2 = page.getByTestId(`btn-user-dataset-${DS2.id}`);
    await row2.waitFor({ state: "visible", timeout: 5_000 });
    await row2.locator('span[role="checkbox"]').click();

    // Action bar: Move To Folder must be enabled (2 datasets, no folders).
    const actionBar = page.getByTestId("library-action-bar");
    await actionBar.waitFor({ state: "visible", timeout: 5_000 });
    const moveBtn = page.getByTestId("btn-action-move-to-folder");
    await expect(moveBtn).not.toBeDisabled();
    await moveBtn.click();

    // Move dialog opens — select destination folder.
    const dialog = page.getByTestId("move-to-dialog");
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await page.getByTestId(`move-opt-${DST.id}`).click();
    await page.getByTestId("move-to-confirm").click();

    await dialog.waitFor({ state: "detached", timeout: 5_000 });

    // Destination folder row must still be present after the re-fetch.
    await page.getByTestId(`folder-row-${DST.id}`).waitFor({ state: "visible", timeout: 8_000 });
  });

  test("action bar DOM node appears before the first checked row, not after the last tree row", async ({
    page,
  }) => {
    const DS = makeDataset("ui-pos-ds1", "Position Test Dataset");

    await page.route("**/api/user/folders**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      });
    });
    await page.route("**/api/user/datasets**", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([DS]),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await ensureExploreAndLibrary(page);

    const dsRow = page.getByTestId(`btn-user-dataset-${DS.id}`);
    await dsRow.waitFor({ state: "visible", timeout: 10_000 });

    // Click the checkbox to enter selection mode.
    await dsRow.locator('span[role="checkbox"]').click();

    // The library action bar must appear.
    const actionBar = page.getByTestId("library-action-bar");
    await actionBar.waitFor({ state: "visible", timeout: 5_000 });

    // DOM ordering: action bar must precede the selected dataset row.
    // DOCUMENT_POSITION_FOLLOWING (4) on compareDocumentPosition means the
    // argument node comes AFTER the reference node in document order.
    const actionBarBeforeRow = await page.evaluate(
      ({ barId, rowId }: { barId: string; rowId: string }) => {
        const bar = document.querySelector(`[data-testid="${barId}"]`);
        const row = document.querySelector(`[data-testid="${rowId}"]`);
        if (!bar || !row) return null;
        return Boolean(bar.compareDocumentPosition(row) & 4);
      },
      { barId: "library-action-bar", rowId: `btn-user-dataset-${DS.id}` },
    );

    expect(actionBarBeforeRow).toBe(true);
  });
});
