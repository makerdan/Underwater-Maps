/**
 * bucket-monitor-persistence.test.ts
 *
 * Unit tests for the DB persistence + restart-rehydration layer added to
 * bucketMonitor.ts (UX audit SEED F-008).
 *
 * Coverage:
 *   ✓ bucketJobDbId — uuid extraction/validation from objectKeys
 *   ✓ processObject persists queued → processing → done upserts (status
 *     "failed" maps to the table's "error" value)
 *   ✓ Non-uuid objectKeys stay memory-only (no DB writes)
 *   ✓ DB persistence failures never break the processing pipeline
 *   ✓ rehydrateBucketJobsFromDb — stale-row sweep, re-queue of pending
 *     objects, and terminal reconciliation (complete / failed / unknown)
 *
 * External I/O is replaced by vi.mock stubs following the pattern of
 * bucket-monitor-process.test.ts, extended with per-key getMetadata()
 * behaviour to drive recoverGcsJobStatus() outcomes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";

// ── GCS mock ──────────────────────────────────────────────────────────────────

const gcsMocks = vi.hoisted(() => {
  const mockCopy = vi.fn().mockResolvedValue([{}]);
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  const mockSetMetadata = vi.fn().mockResolvedValue(undefined);
  const mockCreateReadStream = vi.fn();

  // Per-key metadata behaviour: keys present in this map "exist" in GCS and
  // resolve with the stored metadata object; all others reject (404), which
  // is how recoverGcsJobStatus() distinguishes the prefixes.
  const metadataByKey = new Map<string, Record<string, unknown>>();

  const mockFile = vi.fn().mockImplementation((key: string) => ({
    createReadStream: mockCreateReadStream,
    setMetadata: mockSetMetadata,
    copy: mockCopy,
    delete: mockDelete,
    getMetadata: () => {
      const meta = metadataByKey.get(key);
      return meta !== undefined
        ? Promise.resolve([meta])
        : Promise.reject(new Error("404 Not Found"));
    },
  }));

  const mockGetFiles = vi.fn().mockResolvedValue([[]]);
  const mockBucket = vi.fn().mockReturnValue({ file: mockFile, getFiles: mockGetFiles });

  return { mockCopy, mockDelete, mockSetMetadata, mockCreateReadStream, mockFile, mockGetFiles, mockBucket, metadataByKey };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: gcsMocks.mockBucket,
  })),
}));

// ── DB mock with full insert/update/select chains ─────────────────────────────

const dbMocks = vi.hoisted(() => {
  // insert(table).values({...}).onConflictDoUpdate({...})
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  const insertMock = vi.fn().mockReturnValue({ values: insertValuesMock });

  // update(table).set({...}).where(...) — awaited directly by the terminal
  // reconciler and via .returning({...}) by the stale sweep, so the where()
  // result must be BOTH thenable and expose .returning().
  const updateReturningMock = vi.fn().mockResolvedValue([]);
  const updateWhereMock = vi.fn().mockReturnValue({
    returning: updateReturningMock,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject),
  });
  const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
  const updateMock = vi.fn().mockReturnValue({ set: updateSetMock });

  // select({...}).from(table).where(...) — resolves state.selectRows
  const state = { selectRows: [] as Array<Record<string, unknown>> };
  const selectWhereMock = vi.fn().mockImplementation(() => Promise.resolve(state.selectRows));
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const selectMock = vi.fn().mockReturnValue({ from: selectFromMock });

  return {
    onConflictDoUpdateMock, insertValuesMock, insertMock,
    updateReturningMock, updateWhereMock, updateSetMock, updateMock,
    selectWhereMock, selectFromMock, selectMock, state,
  };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      insert: dbMocks.insertMock,
      update: dbMocks.updateMock,
      select: dbMocks.selectMock,
    },
  });
});

// ── drizzle-orm mock — table stubs are plain strings, so the real operator
//    builders would choke; the db chains above never interpret conditions. ────

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((c: unknown, v: unknown) => ({ op: "eq", c, v })),
  and: vi.fn((...a: unknown[]) => ({ op: "and", a })),
  or: vi.fn((...a: unknown[]) => ({ op: "or", a })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ op: "inArray", c, v })),
  isNotNull: vi.fn((c: unknown) => ({ op: "isNotNull", c })),
  isNull: vi.fn((c: unknown) => ({ op: "isNull", c })),
  lt: vi.fn((c: unknown, v: unknown) => ({ op: "lt", c, v })),
}));

// ── Terrain mock — bypass the real O(N^4) IDW gridder ────────────────────────

const terrainMocks = vi.hoisted(() => {
  const MOCK_TERRAIN = {
    depths: new Array(256 * 256).fill(1000),
    minDepth: 1000,
    maxDepth: 1550,
    resolution: 256,
    id: "mock-grid-id",
    name: "survey",
  };
  return { MOCK_TERRAIN };
});

vi.mock("../lib/terrain.js", async () => {
  const { createTerrainMock } = await import("./helpers/terrainMock.js");
  return createTerrainMock({
    gridPoints: vi.fn().mockReturnValue(terrainMocks.MOCK_TERRAIN),
  });
});

vi.mock("../lib/uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(),
}));

// ── Import the module under test after all mocks are in place ─────────────────

import {
  processObject,
  getJobByObjectKey,
  bucketJobDbId,
  rehydrateBucketJobsFromDb,
  __resetProcessConcurrencyForTests,
} from "../lib/bucketMonitor.js";
import { parseXyzCsv } from "../lib/terrain.js";

// ─────────────────────────────────────────────────────────────────────────────

const MOCK_POINTS = Array.from({ length: 12 }, (_, i) => ({
  lon: 142 + i * 0.01,
  lat: 11 + i * 0.01,
  depth: 1000 + i * 50,
}));

const TEST_BUCKET = "test-bucket-id";

function makeCsvStream(pointCount = 12): Readable {
  const lines = ["lon,lat,depth"];
  for (let i = 0; i < pointCount; i++) {
    lines.push(`${(142 + i * 0.01).toFixed(4)},${(11 + i * 0.01).toFixed(4)},${1000 + i * 50}`);
  }
  return Readable.from([lines.join("\n")]);
}

/** Real (v4-shaped) uuids — the recovery cache is keyed by objectKey, so every
 *  test uses its own uuid to avoid 30 s-TTL cross-test contamination. */
const UUIDS = {
  success: "11111111-1111-4111-8111-111111111111",
  fail: "22222222-2222-4222-8222-222222222222",
  dbdown: "33333333-3333-4333-8333-333333333333",
  pending: "44444444-4444-4444-8444-444444444444",
  complete: "55555555-5555-4555-8555-555555555555",
  failedGcs: "66666666-6666-4666-8666-666666666666",
  gone: "77777777-7777-4777-8777-777777777777",
};

beforeEach(() => {
  process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = TEST_BUCKET;
  __resetProcessConcurrencyForTests();

  gcsMocks.mockCreateReadStream.mockReturnValue(makeCsvStream());
  vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS);

  gcsMocks.metadataByKey.clear();
  gcsMocks.mockCopy.mockClear();
  gcsMocks.mockDelete.mockClear();
  gcsMocks.mockSetMetadata.mockClear();
  gcsMocks.mockFile.mockClear();

  dbMocks.state.selectRows = [];
  dbMocks.insertMock.mockClear();
  dbMocks.insertValuesMock.mockClear();
  dbMocks.onConflictDoUpdateMock.mockClear();
  dbMocks.onConflictDoUpdateMock.mockResolvedValue(undefined);
  dbMocks.updateMock.mockClear();
  dbMocks.updateSetMock.mockClear();
  dbMocks.updateWhereMock.mockClear();
  dbMocks.updateReturningMock.mockClear();
  dbMocks.selectMock.mockClear();
});

afterEach(() => {
  delete process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
});

// ─────────────────────────────────────────────────────────────────────────────
// bucketJobDbId
// ─────────────────────────────────────────────────────────────────────────────

describe("bucketJobDbId", () => {
  it("extracts and lowercases the uuid path segment", () => {
    expect(bucketJobDbId(`pending-datasets/user_a/${UUIDS.success.toUpperCase()}/survey.csv`))
      .toBe(UUIDS.success);
  });

  it("returns null for non-uuid segments (legacy/test keys stay memory-only)", () => {
    expect(bucketJobDbId("pending-datasets/user_a/uuid-success/survey.csv")).toBeNull();
    expect(bucketJobDbId("pending-datasets/user_a")).toBeNull();
    expect(bucketJobDbId("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistBucketJob via processObject
// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — DB persistence", () => {
  it("upserts queued → processing → done rows for a uuid-keyed object", async () => {
    const objectKey = `pending-datasets/user_abc/${UUIDS.success}/survey.csv`;

    await processObject(TEST_BUCKET, objectKey);

    // Dataset insert (customDatasets) + 3 job upserts.
    expect(dbMocks.onConflictDoUpdateMock).toHaveBeenCalledTimes(3);

    // Every upsert carries the deterministic row id + owner.
    for (const call of dbMocks.insertValuesMock.mock.calls) {
      const row = call[0] as Record<string, unknown>;
      // Skip the customDatasets insert (no id field derived from the key).
      if (!("objectKey" in row)) continue;
      expect(row["id"]).toBe(UUIDS.success);
      expect(row["userId"]).toBe("user_abc");
      expect(row["objectKey"]).toBe(objectKey);
    }

    const statuses = dbMocks.onConflictDoUpdateMock.mock.calls.map(
      (c) => ((c[0] as { set: Record<string, unknown> }).set)["status"],
    );
    expect(statuses).toEqual(["queued", "processing", "done"]);

    const doneSet = (dbMocks.onConflictDoUpdateMock.mock.calls[2]![0] as { set: Record<string, unknown> }).set;
    expect(doneSet["progress"]).toBe(100);
    // The pipeline generates a fresh dataset uuid — assert shape, not value.
    expect(doneSet["datasetId"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(doneSet["error"]).toBeNull();
  });

  it("maps job status 'failed' to the table's 'error' value with the message", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3)); // < 10 points

    const objectKey = `pending-datasets/user_xyz/${UUIDS.fail}/sparse.csv`;

    await processObject(TEST_BUCKET, objectKey);

    const lastSet = (dbMocks.onConflictDoUpdateMock.mock.calls.at(-1)![0] as {
      set: Record<string, unknown>;
    }).set;
    expect(lastSet["status"]).toBe("error");
    expect(lastSet["error"]).toMatch(/at least 10/);
  });

  it("does not touch the DB for non-uuid objectKeys", async () => {
    await processObject(TEST_BUCKET, "pending-datasets/user_abc/uuid-nopersist/survey.csv");

    expect(dbMocks.onConflictDoUpdateMock).not.toHaveBeenCalled();
    // The only insert is the customDatasets row from the success pipeline.
    const jobRows = dbMocks.insertValuesMock.mock.calls.filter(
      (c) => "objectKey" in (c[0] as Record<string, unknown>),
    );
    expect(jobRows).toHaveLength(0);
  });

  it("completes processing even when every persist call fails (non-fatal DB outage)", async () => {
    dbMocks.onConflictDoUpdateMock.mockRejectedValue(new Error("db down"));

    const objectKey = `pending-datasets/user_abc/${UUIDS.dbdown}/survey.csv`;

    await processObject(TEST_BUCKET, objectKey);

    const job = getJobByObjectKey(objectKey);
    expect(job?.status).toBe("done");
    expect(job?.datasetId).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rehydrateBucketJobsFromDb
// ─────────────────────────────────────────────────────────────────────────────

describe("rehydrateBucketJobsFromDb", () => {
  it("sweeps stale in-progress rows to error before rehydrating", async () => {
    await rehydrateBucketJobsFromDb();

    // The sweep runs even when no rows need rehydration.
    expect(dbMocks.updateSetMock).toHaveBeenCalled();
    const sweepSet = dbMocks.updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(sweepSet["status"]).toBe("error");
    expect(sweepSet["error"]).toMatch(/did not resume/);
    expect(dbMocks.updateReturningMock).toHaveBeenCalled();
  });

  it("re-queues a job whose object still sits in pending-datasets/", async () => {
    const objectKey = `pending-datasets/user_abc/${UUIDS.pending}/survey.csv`;
    dbMocks.state.selectRows = [{ id: UUIDS.pending, objectKey }];
    // Object exists only under its original pending-datasets/ key.
    gcsMocks.metadataByKey.set(objectKey, {});

    await rehydrateBucketJobsFromDb();

    // processObject is fired without await — poll until the pipeline lands.
    await vi.waitFor(() => {
      expect(getJobByObjectKey(objectKey)?.status).toBe("done");
    });

    // The re-run persisted its own progression ending in done.
    const statuses = dbMocks.onConflictDoUpdateMock.mock.calls.map(
      (c) => ((c[0] as { set: Record<string, unknown> }).set)["status"],
    );
    expect(statuses).toEqual(["queued", "processing", "done"]);
  });

  it("marks a row done when the object already reached processed-datasets/", async () => {
    const objectKey = `pending-datasets/user_abc/${UUIDS.complete}/survey.csv`;
    dbMocks.state.selectRows = [{ id: UUIDS.complete, objectKey }];
    gcsMocks.metadataByKey.set(`processed-datasets/user_abc/${UUIDS.complete}/survey.csv`, {});

    await rehydrateBucketJobsFromDb();

    // Call 0 is the sweep; call 1 is the reconciliation.
    const reconcileSet = dbMocks.updateSetMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(reconcileSet["status"]).toBe("done");
    expect(reconcileSet["progress"]).toBe(100);
    // No re-processing happened.
    expect(getJobByObjectKey(objectKey)).toBeUndefined();
  });

  it("marks a row failed with the recorded message when the object is in failed-datasets/", async () => {
    const objectKey = `pending-datasets/user_abc/${UUIDS.failedGcs}/survey.csv`;
    dbMocks.state.selectRows = [{ id: UUIDS.failedGcs, objectKey }];
    gcsMocks.metadataByKey.set(`failed-datasets/user_abc/${UUIDS.failedGcs}/survey.csv`, {
      metadata: { "x-goog-meta-error": "Depth column missing" },
    });

    await rehydrateBucketJobsFromDb();

    const reconcileSet = dbMocks.updateSetMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(reconcileSet["status"]).toBe("error");
    expect(reconcileSet["error"]).toBe("Depth column missing");
  });

  it("marks a row failed with a re-upload message when the object is gone", async () => {
    const objectKey = `pending-datasets/user_abc/${UUIDS.gone}/survey.csv`;
    dbMocks.state.selectRows = [{ id: UUIDS.gone, objectKey }];
    // No metadata entries at all → recoverGcsJobStatus returns "unknown".

    await rehydrateBucketJobsFromDb();

    const reconcileSet = dbMocks.updateSetMock.mock.calls[1]![0] as Record<string, unknown>;
    expect(reconcileSet["status"]).toBe("error");
    expect(reconcileSet["error"]).toMatch(/re-upload/);
  });

  it("survives a DB query failure without throwing", async () => {
    dbMocks.updateReturningMock.mockRejectedValueOnce(new Error("db down"));

    await expect(rehydrateBucketJobsFromDb()).resolves.toBeUndefined();
    expect(dbMocks.selectMock).not.toHaveBeenCalled();
  });
});
