/**
 * Real auth-gated end-to-end tests for the catch-journal flow.
 *
 * Follows the marker-flow-real.spec.ts pattern: the api-server runs with
 * E2E_AUTH_BYPASS=1 so requests carrying an `x-e2e-user-id` header hit the
 * real requireAuth middleware, real Zod parsing, and real Drizzle SQL against
 * Postgres. Covers the full CRUD lifecycle of catch entries plus the
 * photo-path validation and per-user isolation guarantees.
 */
import { test, expect, type Page, type APIResponse, API_URL, E2E_USER_ID } from "./fixtures";

const DATASET_ID = "thorne-bay";
const API_BASE = API_URL;
const authHeaders = { "x-e2e-user-id": E2E_USER_ID };

interface Marker { id: string; label: string }
interface CatchEntry {
  id: string;
  markerId: string;
  symbol: string;
  symbolName: string;
  notes: string | null;
  photos: string[];
}

async function safeText(res: APIResponse): Promise<string> {
  try { return await res.text(); } catch { return "<no body>"; }
}

async function createMarker(page: Page, label: string): Promise<Marker> {
  const res = await page.request.post(`${API_BASE}/api/markers`, {
    data: { datasetId: DATASET_ID, lon: 142.5, lat: 11.35, depth: -10500, label, type: "custom" },
    headers: authHeaders,
  });
  expect(res.status(), `POST /api/markers → ${res.status()} ${await safeText(res)}`).toBe(201);
  return (await res.json()) as Marker;
}

async function deleteMarker(page: Page, id: string): Promise<void> {
  await page.request.delete(`${API_BASE}/api/markers/${id}`, { headers: authHeaders });
}

test.describe("real auth-gated catch journal flow", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/datasets`);
    expect(res.ok(), `api-server unreachable at ${API_BASE}`).toBe(true);
  });

  test("requires auth: 401 without bypass header", async ({ page }) => {
    const res = await page.request.get(`${API_BASE}/api/catches?datasetId=${DATASET_ID}`);
    expect(res.status()).toBe(401);
  });

  test("full CRUD lifecycle: create → list → patch → delete", async ({ page }) => {
    const marker = await createMarker(page, `e2e-catch-marker-${Date.now()}`);
    try {
      // Create
      const create = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        {
          data: { symbol: "🐟", symbolName: "Fish", notes: "First cast!" },
          headers: authHeaders,
        },
      );
      expect(create.status(), await safeText(create)).toBe(201);
      const entry = (await create.json()) as CatchEntry;
      expect(entry.symbol).toBe("🐟");
      expect(entry.notes).toBe("First cast!");
      expect(entry.markerId).toBe(marker.id);

      // List per-marker
      const listRes = await page.request.get(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { headers: authHeaders },
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as CatchEntry[];
      expect(list.some((c) => c.id === entry.id)).toBe(true);

      // List dataset-wide
      const dsRes = await page.request.get(
        `${API_BASE}/api/catches?datasetId=${DATASET_ID}`,
        { headers: authHeaders },
      );
      expect(dsRes.ok()).toBe(true);
      const dsList = (await dsRes.json()) as CatchEntry[];
      expect(dsList.some((c) => c.id === entry.id)).toBe(true);

      // Patch
      const patch = await page.request.patch(`${API_BASE}/api/catches/${entry.id}`, {
        data: { symbol: "🦀", symbolName: "Crab", notes: "Actually a crab" },
        headers: authHeaders,
      });
      expect(patch.status(), await safeText(patch)).toBe(200);
      const patched = (await patch.json()) as CatchEntry;
      expect(patched.symbol).toBe("🦀");
      expect(patched.notes).toBe("Actually a crab");

      // Delete
      const del = await page.request.delete(`${API_BASE}/api/catches/${entry.id}`, {
        headers: authHeaders,
      });
      expect(del.status()).toBe(204);

      // Second delete → 404
      const del2 = await page.request.delete(`${API_BASE}/api/catches/${entry.id}`, {
        headers: authHeaders,
      });
      expect(del2.status()).toBe(404);
    } finally {
      await deleteMarker(page, marker.id);
    }
  });

  test("create-with-symbol-and-photo happy path: signed upload → entry → photo serves", async ({ page }) => {
    const marker = await createMarker(page, `e2e-catch-photo-happy-${Date.now()}`);
    try {
      // 1. Request a signed upload URL
      const urlRes = await page.request.post(`${API_BASE}/api/catch-photos/upload-url`, {
        headers: authHeaders,
      });
      expect(urlRes.status(), await safeText(urlRes)).toBe(200);
      const { uploadURL, objectPath } = (await urlRes.json()) as {
        uploadURL: string;
        objectPath: string;
      };
      expect(objectPath.startsWith("/objects/")).toBe(true);

      // 2. PUT a tiny PNG to the signed URL
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      );
      const put = await page.request.put(uploadURL, {
        data: png,
        headers: { "Content-Type": "image/png" },
      });
      expect(put.ok(), `PUT signed URL → ${put.status()}`).toBe(true);

      // 3. Create the catch entry referencing the uploaded photo
      const create = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        {
          data: { symbol: "🐟", symbolName: "Fish", notes: "with photo", photos: [objectPath] },
          headers: authHeaders,
        },
      );
      expect(create.status(), await safeText(create)).toBe(201);
      const entry = (await create.json()) as CatchEntry;
      expect(entry.photos).toEqual([objectPath]);

      // 4. Owner can download the photo through the ACL-checked objects route
      const photo = await page.request.get(`${API_BASE}/api${objectPath}`, {
        headers: authHeaders,
      });
      expect(photo.status(), `GET ${objectPath} → ${photo.status()}`).toBe(200);

      await page.request.delete(`${API_BASE}/api/catches/${entry.id}`, { headers: authHeaders });
    } finally {
      await deleteMarker(page, marker.id);
    }
  });

  test("multiple catch entries (incl. duplicate symbols) coexist on one spot", async ({ page }) => {
    const marker = await createMarker(page, `e2e-catch-multi-${Date.now()}`);
    try {
      const symbols = ["🐟", "🐟", "🦀"]; // two salmon-style repeats + a crab
      const ids: string[] = [];
      for (const symbol of symbols) {
        const res = await page.request.post(
          `${API_BASE}/api/markers/${marker.id}/catches`,
          { data: { symbol }, headers: authHeaders },
        );
        expect(res.status(), await safeText(res)).toBe(201);
        ids.push(((await res.json()) as CatchEntry).id);
      }

      // All three entries — including the duplicate-symbol pair — are listed
      const listRes = await page.request.get(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { headers: authHeaders },
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as CatchEntry[];
      const mine = list.filter((c) => ids.includes(c.id));
      expect(mine).toHaveLength(3);
      expect(mine.map((c) => c.symbol).sort()).toEqual(["🐟", "🐟", "🦀"]);

      // Deleting one duplicate leaves the other intact
      const del = await page.request.delete(`${API_BASE}/api/catches/${ids[0]}`, {
        headers: authHeaders,
      });
      expect(del.status()).toBe(204);
      const after = await page.request.get(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { headers: authHeaders },
      );
      const remaining = ((await after.json()) as CatchEntry[]).filter((c) =>
        ids.includes(c.id),
      );
      expect(remaining.map((c) => c.symbol).sort()).toEqual(["🐟", "🦀"]);
    } finally {
      await deleteMarker(page, marker.id);
    }
  });

  test("rejects photo paths outside /objects/ and >6 photos", async ({ page }) => {
    const marker = await createMarker(page, `e2e-catch-photos-${Date.now()}`);
    try {
      const bad = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        {
          data: { symbol: "🐟", photos: ["https://evil.example.com/x.png"] },
          headers: authHeaders,
        },
      );
      expect(bad.status()).toBe(400);

      const many = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        {
          data: {
            symbol: "🐟",
            photos: Array.from({ length: 7 }, (_, i) => `/objects/uploads/p${i}`),
          },
          headers: authHeaders,
        },
      );
      expect(many.status()).toBe(400);
    } finally {
      await deleteMarker(page, marker.id);
    }
  });

  test("per-user isolation: another user cannot see, edit, or delete my catches", async ({ page }) => {
    const otherHeaders = { "x-e2e-user-id": `${E2E_USER_ID}-other` };
    const marker = await createMarker(page, `e2e-catch-iso-${Date.now()}`);
    try {
      const create = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { data: { symbol: "🐟" }, headers: authHeaders },
      );
      expect(create.status()).toBe(201);
      const entry = (await create.json()) as CatchEntry;

      // Other user: marker not owned → 404 on per-marker list & create
      const otherList = await page.request.get(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { headers: otherHeaders },
      );
      expect(otherList.status()).toBe(404);

      const otherCreate = await page.request.post(
        `${API_BASE}/api/markers/${marker.id}/catches`,
        { data: { symbol: "🦑" }, headers: otherHeaders },
      );
      expect(otherCreate.status()).toBe(404);

      // Other user: patch/delete my entry → 404
      const otherPatch = await page.request.patch(
        `${API_BASE}/api/catches/${entry.id}`,
        { data: { notes: "hijack" }, headers: otherHeaders },
      );
      expect(otherPatch.status()).toBe(404);

      const otherDel = await page.request.delete(
        `${API_BASE}/api/catches/${entry.id}`,
        { headers: otherHeaders },
      );
      expect(otherDel.status()).toBe(404);

      // Dataset-wide list for the other user excludes my entry
      const otherDs = await page.request.get(
        `${API_BASE}/api/catches?datasetId=${DATASET_ID}`,
        { headers: otherHeaders },
      );
      expect(otherDs.ok()).toBe(true);
      const otherEntries = (await otherDs.json()) as CatchEntry[];
      expect(otherEntries.some((c) => c.id === entry.id)).toBe(false);

      // Cleanup my entry
      await page.request.delete(`${API_BASE}/api/catches/${entry.id}`, { headers: authHeaders });
    } finally {
      await deleteMarker(page, marker.id);
    }
  });

  test("deleting a marker cascades its catch entries", async ({ page }) => {
    const marker = await createMarker(page, `e2e-catch-cascade-${Date.now()}`);
    const create = await page.request.post(
      `${API_BASE}/api/markers/${marker.id}/catches`,
      { data: { symbol: "🦞" }, headers: authHeaders },
    );
    expect(create.status()).toBe(201);
    const entry = (await create.json()) as CatchEntry;

    await deleteMarker(page, marker.id);

    // Entry is gone: patch/delete return 404
    const patch = await page.request.patch(`${API_BASE}/api/catches/${entry.id}`, {
      data: { notes: "still here?" },
      headers: authHeaders,
    });
    expect(patch.status()).toBe(404);
  });
});
