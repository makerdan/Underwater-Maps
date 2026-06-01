/**
 * bucket-monitor-process.test.ts
 *
 * Unit tests for the processObject pipeline in bucketMonitor.ts.
 *
 * Coverage:
 *   ✓ Success path — CSV parsed, terrain gridded, dataset inserted,
 *     object moved to processed-datasets/
 *   ✓ Failure path — parse produces < 10 points, error recorded in job,
 *     object moved to failed-datasets/ with x-goog-meta-error metadata
 *   ✓ GCS move error after parse failure — move failure is swallowed so
 *     the job still records the original parse error
 *
 * External I/O is replaced by vi.mock stubs:
 *   @google-cloud/storage — bucket / file / stream operations
 *   @workspace/db         — db.insert
 *   ../lib/terrain.js     — parseXyzCsv + gridPoints (avoids O(N^4) IDW)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";

// ── GCS mock (hoisted so the factory closure can reference the spy objects) ───

const gcsMocks = vi.hoisted(() => {
  const mockCopy = vi.fn().mockResolvedValue([{}]);
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  const mockSetMetadata = vi.fn().mockResolvedValue(undefined);
  const mockCreateReadStream = vi.fn();

  const mockFile = vi.fn().mockImplementation(() => ({
    createReadStream: mockCreateReadStream,
    setMetadata: mockSetMetadata,
    copy: mockCopy,
    delete: mockDelete,
  }));

  const mockGetFiles = vi.fn().mockResolvedValue([[]]);

  const mockBucket = vi.fn().mockReturnValue({
    file: mockFile,
    getFiles: mockGetFiles,
  });

  return { mockCopy, mockDelete, mockSetMetadata, mockCreateReadStream, mockFile, mockGetFiles, mockBucket };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: gcsMocks.mockBucket,
  })),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
// Hoisted so both the vi.mock factory and the test body can reference the same
// spy instances — enabling mockClear() in beforeEach without re-importing.

const dbMocks = vi.hoisted(() => {
  const valuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  return { valuesMock, insertMock };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: dbMocks.insertMock,
  },
  customDatasetsTable: { id: "id", userId: "userId", name: "name", minDepth: "minDepth", maxDepth: "maxDepth", terrainJson: "terrainJson", overviewJson: "overviewJson" },
}));

// ── Terrain mock — bypass the real O(N^4) IDW gridder ────────────────────────
// MOCK_TERRAIN must be defined via vi.hoisted() because vi.mock factories are
// hoisted above regular variable declarations and cannot close over them.

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

vi.mock("../lib/terrain.js", () => ({
  parseXyzCsv: vi.fn(),
  gridPoints: vi.fn().mockReturnValue(terrainMocks.MOCK_TERRAIN),
  ALL_PRESET_DATASETS: [],
  buildTerrainGrid: vi.fn(),
  previewDataset: vi.fn(),
  previewBboxForDownload: vi.fn(),
  buildBboxCsvRows: vi.fn(),
}));

vi.mock("../lib/uploadParsers.js", () => ({
  parseUploadedFile: vi.fn(),
}));

// ── Import the module under test after all mocks are in place ─────────────────

import { processObject, getJobByObjectKey } from "../lib/bucketMonitor.js";
import { parseXyzCsv } from "../lib/terrain.js";
import { parseUploadedFile } from "../lib/uploadParsers.js";
import { gzipSync } from "zlib";

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

beforeEach(() => {
  process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = TEST_BUCKET;

  // Default: createReadStream returns a valid CSV stream
  gcsMocks.mockCreateReadStream.mockReturnValue(makeCsvStream());

  // Default: parseXyzCsv returns 12 valid points
  vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS);

  // Reset call history
  gcsMocks.mockCopy.mockClear();
  gcsMocks.mockDelete.mockClear();
  gcsMocks.mockSetMetadata.mockClear();
  gcsMocks.mockFile.mockClear();
  dbMocks.insertMock.mockClear();
  dbMocks.valuesMock.mockClear();
  vi.mocked(parseUploadedFile).mockClear();
});

afterEach(() => {
  delete process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
});

// ─────────────────────────────────────────────────────────────────────────────
// Success path
// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — success path", () => {
  it("records a 'done' job after processing a valid CSV object", async () => {
    const objectKey = "pending-datasets/user_abc/uuid-success/survey.csv";

    await processObject(TEST_BUCKET, objectKey);

    const job = getJobByObjectKey(objectKey);
    expect(job).toBeDefined();
    expect(job!.status).toBe("done");
    expect(job!.userId).toBe("user_abc");
    expect(job!.datasetId).toBeDefined();
    expect(typeof job!.datasetId).toBe("string");
    expect(job!.finishedAt).toBeDefined();
    expect(job!.error).toBeUndefined();
  });

  it("inserts a row into the database for the processed dataset", async () => {
    const objectKey = "pending-datasets/user_abc/uuid-dbinsert/survey.csv";

    await processObject(TEST_BUCKET, objectKey);

    expect(dbMocks.insertMock).toHaveBeenCalledOnce();
    expect(dbMocks.valuesMock).toHaveBeenCalledOnce();

    const row = dbMocks.valuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toHaveProperty("userId", "user_abc");
    expect(row).toHaveProperty("name");
    expect(row).toHaveProperty("minDepth");
    expect(row).toHaveProperty("maxDepth");
  });

  it("moves the object to processed-datasets/ prefix on success", async () => {
    const objectKey = "pending-datasets/user_abc/uuid-move/survey.csv";

    await processObject(TEST_BUCKET, objectKey);

    // copy() is called with the destination file object
    expect(gcsMocks.mockCopy).toHaveBeenCalledOnce();

    // The destination key is the second argument — it's a file() call result.
    // Verify that file() was called with a processed-datasets/ key.
    const fileCallArgs = gcsMocks.mockFile.mock.calls.map((c) => c[0] as string);
    const destKey = fileCallArgs.find((k) => k.startsWith("processed-datasets/"));
    expect(destKey).toBeDefined();
    expect(destKey).toBe("processed-datasets/user_abc/uuid-move/survey.csv");

    // delete() is called to remove the source object
    expect(gcsMocks.mockDelete).toHaveBeenCalledOnce();

    // setMetadata should NOT be called on the success path
    expect(gcsMocks.mockSetMetadata).not.toHaveBeenCalled();
  });

  it("extracts the dataset name from the filename (strips extension, replaces separators)", async () => {
    const objectKey = "pending-datasets/user_abc/uuid-name/my_survey-2024.csv";

    await processObject(TEST_BUCKET, objectKey);

    expect(dbMocks.valuesMock).toHaveBeenCalledOnce();
    const row = dbMocks.valuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row["name"]).toBe("my survey 2024");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure path — parse produces too few points
// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — failure path (too few points)", () => {
  it("records a 'failed' job when fewer than 10 points are parsed", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3)); // only 3 points

    const objectKey = "pending-datasets/user_xyz/uuid-fail/sparse.csv";

    await processObject(TEST_BUCKET, objectKey);

    const job = getJobByObjectKey(objectKey);
    expect(job).toBeDefined();
    expect(job!.status).toBe("failed");
    expect(job!.error).toMatch(/at least 10/);
    expect(job!.finishedAt).toBeDefined();
    expect(job!.datasetId).toBeUndefined();
  });

  it("does NOT insert a database row when processing fails", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3));

    const objectKey = "pending-datasets/user_xyz/uuid-nodb/sparse.csv";

    await processObject(TEST_BUCKET, objectKey);

    expect(dbMocks.insertMock).not.toHaveBeenCalled();
  });

  it("sets x-goog-meta-error metadata on the object before moving it", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3));

    const objectKey = "pending-datasets/user_xyz/uuid-meta/sparse.csv";

    await processObject(TEST_BUCKET, objectKey);

    expect(gcsMocks.mockSetMetadata).toHaveBeenCalledOnce();
    const [metadataArg] = gcsMocks.mockSetMetadata.mock.calls[0] as [{ metadata: Record<string, string> }];
    expect(metadataArg).toHaveProperty("metadata");
    expect(metadataArg.metadata["x-goog-meta-error"]).toMatch(/at least 10/);
  });

  it("moves the object to failed-datasets/ prefix on failure", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3));

    const objectKey = "pending-datasets/user_xyz/uuid-failmove/sparse.csv";

    await processObject(TEST_BUCKET, objectKey);

    // copy() is called during the failure move
    expect(gcsMocks.mockCopy).toHaveBeenCalledOnce();

    const fileCallArgs = gcsMocks.mockFile.mock.calls.map((c) => c[0] as string);
    const destKey = fileCallArgs.find((k) => k.startsWith("failed-datasets/"));
    expect(destKey).toBeDefined();
    expect(destKey).toBe("failed-datasets/user_xyz/uuid-failmove/sparse.csv");

    // delete() is called to remove the source object
    expect(gcsMocks.mockDelete).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure path — GCS move fails after a parse error
// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — failure path (GCS move itself fails)", () => {
  it("preserves the original parse error in the job even when the move to failed-datasets/ also throws", async () => {
    vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS.slice(0, 3));
    gcsMocks.mockCopy.mockRejectedValueOnce(new Error("GCS network error"));

    const objectKey = "pending-datasets/user_xyz/uuid-movefail/sparse.csv";

    await processObject(TEST_BUCKET, objectKey);

    const job = getJobByObjectKey(objectKey);
    expect(job).toBeDefined();
    // Job should still report failed with the original parse error
    expect(job!.status).toBe("failed");
    expect(job!.error).toMatch(/at least 10/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// .gz binary path — parseUploadedFile receives the stripped base name
// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — .gz binary format (e.g. .las.gz)", () => {
  it("calls parseUploadedFile with the base name (no .gz suffix), not the original .gz filename", async () => {
    // Build a valid gzip stream wrapping dummy binary bytes (simulates a .las file)
    const dummyInner = Buffer.from("dummy las binary content");
    const gzippedBytes = gzipSync(dummyInner);
    gcsMocks.mockCreateReadStream.mockReturnValue(Readable.from([gzippedBytes]));

    vi.mocked(parseUploadedFile).mockResolvedValue(MOCK_POINTS);

    const objectKey = "pending-datasets/user_abc/uuid-lasgz/survey.las.gz";
    await processObject(TEST_BUCKET, objectKey);

    expect(vi.mocked(parseUploadedFile)).toHaveBeenCalledOnce();
    const [, filenameArg] = vi.mocked(parseUploadedFile).mock.calls[0]!;
    expect(filenameArg).toBe("survey.las");
    expect(filenameArg).not.toMatch(/\.gz$/i);

    const job = getJobByObjectKey(objectKey);
    expect(job?.status).toBe("done");
  });
});
