import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Dataset folders E2E.
 *
 * Strategy:
 *   The folder system is fully auth-gated (every /user/folders route runs
 *   through requireAuth). The Playwright webServer for api-server is started
 *   with E2E_AUTH_BYPASS=1, which accepts an x-e2e-user-id header in lieu of
 *   a Clerk JWT. We drive the real folders API directly against the
 *   api-server on port 3151 (configured in playwright.config.ts), which
 *   exercises:
 *     - create / rename / move / duplicate / delete folder endpoints
 *     - dataset move + duplicate
 *     - cycle prevention, ownership checks, and sibling-name uniqueness
 *     - persistence across "reloads" (a fresh request context)
 */

const API_BASE = "http://localhost:3151/api";
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
