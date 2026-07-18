/**
 * Quick-drop (one-tap GPS catch marker) end-to-end tests.
 *
 * Companion to `marker-flow-real.spec.ts` — exercises the REAL auth-gated
 * REST surface via `E2E_AUTH_BYPASS` + `x-e2e-user-id`:
 *
 *   - POST /api/markers with `quickCatch: true` → server assigns "Catch N"
 *     from the per-user monotonic counter and persists the frozen conditions
 *     snapshot.
 *   - Sequence numbers are never reused after a delete (delete Catch 2,
 *     next drop is Catch 3).
 *   - The snapshot is immutable: PATCH cannot alter `conditions` and a rename
 *     leaves the snapshot untouched.
 *
 * The floating QuickDropButton itself is gated on an active GPS fix plus a
 * loaded WebGL terrain, which headless Chromium cannot provide — its tap /
 * long-press behaviour is covered by unit tests; this spec covers the
 * server-side contract end-to-end against real Postgres.
 *
 * Each test uses a UNIQUE user id so the per-user counter starts at 1 and
 * parallel runs cannot interfere.
 */
import { test, expect, type Page, API_URL } from "./fixtures";

const DATASET_ID = "thorne-bay";
const API_BASE = API_URL;

interface QuickMarker {
  id: string;
  label: string;
  catchSeq: number | null;
  conditions: Record<string, unknown> | null;
  lon: number;
  lat: number;
}

const CONDITIONS = {
  capturedAt: new Date().toISOString(),
  gpsAccuracyM: 8,
  speedMps: 1.2,
  headingDeg: 271,
  depthM: 42.5,
  depthSource: "terrain",
  tideHeightM: 1.8,
  currentSpeedKt: 0.6,
  currentDirDeg: 130,
  tideSource: "pack",
  windSpeedKnots: null,
  windDirDeg: null,
  tempC: null,
  weatherObservedAt: null,
  weatherSource: "unavailable",
};

function uniqueUser(tag: string): string {
  return `e2e-quickdrop-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function quickDrop(
  page: Page,
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<QuickMarker> {
  const res = await page.request.post(`${API_BASE}/api/markers`, {
    headers: { "x-e2e-user-id": userId },
    data: {
      datasetId: DATASET_ID,
      lon: 142.5,
      lat: 11.35,
      depth: 42,
      type: "custom",
      label: "Catch",
      quickCatch: true,
      conditions: CONDITIONS,
      ...extra,
    },
  });
  expect(res.status(), `quickCatch POST should 201, got ${res.status()}: ${await res.text().catch(() => "")}`).toBe(201);
  return (await res.json()) as QuickMarker;
}

test.describe("Quick drop — server contract", () => {
  test("first drop is auto-named 'Catch 1' with the conditions snapshot stored", async ({ page }) => {
    const userId = uniqueUser("first");
    const created = await quickDrop(page, userId);

    expect(created.label).toBe("Catch 1");
    expect(created.catchSeq).toBe(1);
    expect(created.conditions).toBeTruthy();
    expect(created.conditions).toMatchObject({
      depthSource: "terrain",
      tideSource: "pack",
      gpsAccuracyM: 8,
      headingDeg: 271,
    });
  });

  test("sequence increments and is never reused after a delete", async ({ page }) => {
    const userId = uniqueUser("seq");
    const first = await quickDrop(page, userId);
    const second = await quickDrop(page, userId);
    expect(first.label).toBe("Catch 1");
    expect(second.label).toBe("Catch 2");

    // Delete Catch 2 — the counter must NOT roll back.
    const del = await page.request.delete(`${API_BASE}/api/markers/${second.id}`, {
      headers: { "x-e2e-user-id": userId },
    });
    expect(del.status()).toBe(204);

    const third = await quickDrop(page, userId);
    expect(third.label).toBe("Catch 3");
    expect(third.catchSeq).toBe(3);
  });

  test("counter is per-user — two users each start at Catch 1", async ({ page }) => {
    const userA = uniqueUser("userA");
    const userB = uniqueUser("userB");
    const a = await quickDrop(page, userA);
    const b = await quickDrop(page, userB);
    expect(a.label).toBe("Catch 1");
    expect(b.label).toBe("Catch 1");
  });

  test("client-provided label is overridden when quickCatch is set", async ({ page }) => {
    const userId = uniqueUser("label");
    const created = await quickDrop(page, userId, { label: "My fancy name" });
    expect(created.label).toBe("Catch 1");
  });

  test("normal (non-quickCatch) creates skip the counter and store no snapshot", async ({ page }) => {
    const userId = uniqueUser("normal");
    const res = await page.request.post(`${API_BASE}/api/markers`, {
      headers: { "x-e2e-user-id": userId },
      data: {
        datasetId: DATASET_ID,
        lon: 142.5,
        lat: 11.35,
        depth: 42,
        type: "custom",
        label: "Manual marker",
      },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()) as QuickMarker;
    expect(created.label).toBe("Manual marker");
    expect(created.catchSeq).toBeNull();
    expect(created.conditions).toBeNull();

    // Next quick drop is still Catch 1 — manual creates never consumed a seq.
    const quick = await quickDrop(page, userId);
    expect(quick.label).toBe("Catch 1");
  });

  test("snapshot is frozen — rename via PATCH leaves conditions untouched", async ({ page }) => {
    const userId = uniqueUser("frozen");
    const created = await quickDrop(page, userId);

    const patch = await page.request.patch(`${API_BASE}/api/markers/${created.id}`, {
      headers: { "x-e2e-user-id": userId },
      data: { label: "Renamed catch", notes: "big halibut" },
    });
    expect(patch.status()).toBe(200);

    const list = await page.request.get(`${API_BASE}/api/markers?datasetId=${DATASET_ID}`, {
      headers: { "x-e2e-user-id": userId },
    });
    expect(list.ok()).toBe(true);
    const markers = (await list.json()) as QuickMarker[];
    const found = markers.find((m) => m.id === created.id);
    expect(found).toBeTruthy();
    expect(found!.label).toBe("Renamed catch");
    expect(found!.catchSeq).toBe(1);
    expect(found!.conditions).toMatchObject({ depthSource: "terrain", gpsAccuracyM: 8 });
  });

  test("malformed conditions snapshot is rejected with 400", async ({ page }) => {
    const userId = uniqueUser("badcond");
    const res = await page.request.post(`${API_BASE}/api/markers`, {
      headers: { "x-e2e-user-id": userId },
      data: {
        datasetId: DATASET_ID,
        lon: 142.5,
        lat: 11.35,
        depth: 42,
        type: "custom",
        label: "Catch",
        quickCatch: true,
        conditions: { ...CONDITIONS, depthSource: "sonar" },
      },
    });
    expect(res.status()).toBe(400);
  });

  test("quickCatch requires auth", async ({ page }) => {
    const res = await page.request.post(`${API_BASE}/api/markers`, {
      data: {
        datasetId: DATASET_ID,
        lon: 142.5,
        lat: 11.35,
        depth: 42,
        type: "custom",
        label: "Catch",
        quickCatch: true,
      },
    });
    expect(res.status()).toBe(401);
  });
});
