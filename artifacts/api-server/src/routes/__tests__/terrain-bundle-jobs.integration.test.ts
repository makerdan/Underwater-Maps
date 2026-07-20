/**
 * terrain-bundle-jobs.integration.test.ts
 *
 * Integration tests for the terrain bundle job pipeline using the REAL
 * Postgres test database (via @workspace/db) — no drizzle mocks. Network
 * and object storage are mocked so the suite runs offline:
 *
 *   - full state machine: POST → pending → running → complete (row + GCS)
 *   - fetch failure: fetcher throws → status "error" with persisted message
 *   - GCS failure: object storage save throws → status "error" persisted
 *   - restart recovery: a row stuck in "running" is reset to "pending" and
 *     re-dispatched to completion by recoverStaleTerrainBundleJobs()
 *   - duplicate-dispatch protection: concurrent recovery sweeps run a job
 *     exactly once
 *   - catalog fallback: a presetId that only exists as a catalog entry
 *     resolves via deriveCatalogFetchStrategy instead of 404/422-ing
 *
 * Rows are keyed by per-test unique user ids (itest-<uuid>) and cleaned up
 * after each test, so runs never collide with each other or real data.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Mocks (object storage + fetchers + preset registry). @workspace/db is REAL.
// ---------------------------------------------------------------------------

const gcsFiles = new Map<string, string>();
let gcsSaveError: Error | null = null;

vi.mock("../../lib/objectStorage.js", () => ({
  objectStorageClient: {
    bucket: (bucketName: string) => ({
      file: (objectName: string) => {
        const key = `${bucketName}/${objectName}`;
        return {
          exists: async () => [gcsFiles.has(key)],
          save: async (contents: string) => {
            if (gcsSaveError) throw gcsSaveError;
            gcsFiles.set(key, contents);
          },
          download: async () => [Buffer.from(gcsFiles.get(key) ?? "{}")],
        };
      },
    }),
  },
}));

const TEST_BBOX = { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 };

vi.mock("../../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: {},
  NYSDEC_BATHY_FEATURE_SERVICE: "https://example.com/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://example.com/mn-dnr",
  ALL_PRESET_DATASETS: [
    {
      id: "itest-preset",
      name: "Integration test preset",
      waterType: "freshwater",
      bbox: { minLon: -97.15, minLat: 33.3, maxLon: -96.92, maxLat: 33.52 },
      fetchStrategy: { kind: "bundled" },
    },
  ],
}));

vi.mock("../../lib/catalogSeeder.js", () => ({
  getCatalogEntries: async () => [
    {
      id: "itest-catalog-lake",
      name: "Integration test catalog lake",
      dataType: "bathymetry",
      coverageBbox: { minLon: -107.72, minLat: 36.8, maxLon: -107.3, maxLat: 37.1 },
      endpointUrl:
        "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/WCSServer",
      waterType: "freshwater",
    },
  ],
}));

const SAMPLE_BUNDLE = {
  depths: [1, 2, 3, 4],
  topography: [0, 0, 0, 0],
  hasTopography: false,
  minDepth: 1,
  maxDepth: 4,
  width: 2,
  height: 2,
  bbox: TEST_BBOX,
  dataSource: "test",
  label: "Test bundle",
  creditUrl: "https://example.com",
};

const mockFetch = vi.fn();

vi.mock("../../lib/fetchers/index.js", () => ({
  getFetcher: vi.fn(() => ({
    probe: vi.fn(async () => ({ available: true, title: "Test" })),
    fetch: mockFetch,
  })),
}));

process.env["E2E_AUTH_BYPASS"] = "1";
process.env["PRIVATE_OBJECT_DIR"] = "/itest-bucket/private/";

// Import after mocks — real db, real route logic.
const { db, terrainBundleJobsTable } = await import("@workspace/db");
const { eq, and, inArray } = await import("drizzle-orm");
const {
  default: terrainBundlesRouter,
  recoverStaleTerrainBundleJobs,
  dispatchBundleJob,
} = await import("../terrain-bundles.js");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(terrainBundlesRouter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const usedUserIds: string[] = [];

function newUserId(): string {
  const id = `itest-${randomUUID()}`;
  usedUserIds.push(id);
  return id;
}

async function getJobRow(userId: string, presetId: string) {
  const rows = await db
    .select()
    .from(terrainBundleJobsTable)
    .where(
      and(
        eq(terrainBundleJobsTable.userId, userId),
        eq(terrainBundleJobsTable.presetId, presetId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function waitForStatus(
  userId: string,
  presetId: string,
  statuses: string[],
  timeoutMs = 8000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await getJobRow(userId, presetId);
    if (row && statuses.includes(row.status)) return row;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for status in [${statuses.join(",")}], last=${row?.status ?? "none"}`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  gcsFiles.clear();
  gcsSaveError = null;
  mockFetch.mockResolvedValue({ ...SAMPLE_BUNDLE });
});

afterEach(async () => {
  if (usedUserIds.length > 0) {
    await db
      .delete(terrainBundleJobsTable)
      .where(inArray(terrainBundleJobsTable.userId, usedUserIds));
  }
});

afterAll(async () => {
  if (usedUserIds.length > 0) {
    await db
      .delete(terrainBundleJobsTable)
      .where(inArray(terrainBundleJobsTable.userId, usedUserIds));
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("terrain bundle job state machine (real DB)", () => {
  it("walks pending → running → complete and writes the bundle to storage", async () => {
    const userId = newUserId();

    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-preset" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");

    const row = await waitForStatus(userId, "itest-preset", ["complete", "error"]);
    expect(row.status).toBe("complete");
    expect(row.completedAt).not.toBeNull();
    expect(row.errorMessage).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Bundle landed in storage under the per-user path.
    const key = `itest-bucket/users/${userId}/terrain/itest-preset.bundle.json`;
    expect(gcsFiles.has(key)).toBe(true);

    // GET returns the stored bundle.
    const getRes = await request(app)
      .get("/terrain/bundles/itest-preset")
      .set("x-e2e-user-id", userId);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ label: "Test bundle", presetId: "itest-preset" });

    // Re-POST short-circuits: bundle already available.
    const rePost = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-preset" });
    expect(rePost.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("persists error state when the fetch step fails, and retry works", async () => {
    const userId = newUserId();
    mockFetch.mockRejectedValueOnce(new Error("upstream WCS unreachable"));

    await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-preset" })
      .expect(202);

    const row = await waitForStatus(userId, "itest-preset", ["complete", "error"]);
    expect(row.status).toBe("error");
    expect(row.errorMessage).toContain("upstream WCS unreachable");
    expect(row.completedAt).not.toBeNull();

    // Status endpoint surfaces the error.
    const statusRes = await request(app)
      .get("/terrain/bundles/itest-preset/status")
      .set("x-e2e-user-id", userId);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("error");
    expect(statusRes.body.errorMessage).toContain("upstream WCS unreachable");

    // Retry: POST re-queues the errored job and it completes.
    const retryRes = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-preset" });
    expect(retryRes.status).toBe(202);
    expect(retryRes.body.message).toContain("Retrying");

    const retried = await waitForStatus(userId, "itest-preset", ["complete"]);
    expect(retried.status).toBe("complete");
  });

  it("persists error state when object storage is unavailable", async () => {
    const userId = newUserId();
    gcsSaveError = new Error("GCS unavailable: 503");

    await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-preset" })
      .expect(202);

    const row = await waitForStatus(userId, "itest-preset", ["complete", "error"]);
    expect(row.status).toBe("error");
    expect(row.errorMessage).toContain("GCS unavailable");
  });

  it("resolves catalog-only presets via the derived fetchStrategy", async () => {
    const userId = newUserId();

    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "itest-catalog-lake" });
    expect(res.status).toBe(202);

    const row = await waitForStatus(userId, "itest-catalog-lake", ["complete", "error"]);
    expect(row.status).toBe("complete");
    // Fetch was called with the catalog entry's coverage bbox.
    expect(mockFetch).toHaveBeenCalledWith(
      { kind: "usgs-3dep" },
      { minLon: -107.72, minLat: 36.8, maxLon: -107.3, maxLat: 37.1 },
      256,
    );
  });

  it("still 404s for ids unknown to both registry and catalog", async () => {
    const userId = newUserId();
    const res = await request(app)
      .post("/terrain/bundles")
      .set("x-e2e-user-id", userId)
      .send({ presetId: "definitely-not-a-preset" });
    expect(res.status).toBe(404);
  });
});

describe("restart recovery (real DB)", () => {
  it("resets a stuck running job to pending and re-dispatches it to completion", async () => {
    const userId = newUserId();

    // Simulate a job the previous process died on.
    await db.insert(terrainBundleJobsTable).values({
      userId,
      presetId: "itest-preset",
      status: "running",
      progressNote: "Fetching bathymetry data…",
    });

    const redispatched = await recoverStaleTerrainBundleJobs();
    expect(redispatched).toBeGreaterThanOrEqual(1);

    const row = await waitForStatus(userId, "itest-preset", ["complete", "error"]);
    expect(row.status).toBe("complete");
    expect(mockFetch).toHaveBeenCalled();
  });

  it("does not dispatch the same job twice under concurrent recovery sweeps", async () => {
    const userId = newUserId();

    let releaseFetch!: () => void;
    const gate = new Promise<void>((r) => (releaseFetch = r));
    mockFetch.mockImplementation(async () => {
      await gate;
      return { ...SAMPLE_BUNDLE };
    });

    const [inserted] = await db
      .insert(terrainBundleJobsTable)
      .values({
        userId,
        presetId: "itest-preset",
        status: "running",
        progressNote: "Fetching bathymetry data…",
      })
      .returning();

    // Two overlapping recovery sweeps + a direct duplicate dispatch.
    await recoverStaleTerrainBundleJobsWhileBlocked();
    dispatchBundleJob(inserted!.id, userId, "itest-preset");

    // Give the event loop a moment — a duplicate dispatch would call fetch again.
    await new Promise((r) => setTimeout(r, 200));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    releaseFetch();
    const row = await waitForStatus(userId, "itest-preset", ["complete", "error"]);
    expect(row.status).toBe("complete");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    async function recoverStaleTerrainBundleJobsWhileBlocked() {
      await recoverStaleTerrainBundleJobs();
      // Wait until the (blocked) job has flipped to running so the second
      // sweep's "pending" select no longer picks it up spuriously — the
      // in-flight guard must be what prevents the duplicate.
      await waitForStatus(userId, "itest-preset", ["running"]);
      await recoverStaleTerrainBundleJobs();
    }
  });
});
