/**
 * bucket-monitor-concurrency.test.ts
 *
 * Verifies that a burst of pending objects is processed at most
 * PROCESS_CONCURRENCY_CAP at a time, while all objects still complete
 * and per-job status tracking (dedupe map + error recording) is preserved.
 *
 * Concurrency is measured at the GCS download step: each createReadStream
 * call returns a gated stream that does not emit data until the test
 * releases it, so the number of simultaneously-open streams equals the
 * number of pipelines that have acquired a processing slot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";

// ── GCS mock ─────────────────────────────────────────────────────────────────

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

// ── DB mock ──────────────────────────────────────────────────────────────────

const dbMocks = vi.hoisted(() => {
  const valuesMock = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  return { valuesMock, insertMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({ db: { insert: dbMocks.insertMock } });
});

// ── Terrain mock — bypass the real O(N^4) IDW gridder ────────────────────────

const terrainMocks = vi.hoisted(() => {
  const MOCK_TERRAIN = {
    depths: new Array(4).fill(1000),
    minDepth: 1000,
    maxDepth: 1550,
    resolution: 2,
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

// ── Module under test ────────────────────────────────────────────────────────

import {
  processObject,
  getJobByObjectKey,
  PROCESS_CONCURRENCY_CAP,
} from "../lib/bucketMonitor.js";
import { parseXyzCsv } from "../lib/terrain.js";

// ─────────────────────────────────────────────────────────────────────────────

const TEST_BUCKET = "test-bucket-id";

const MOCK_POINTS = Array.from({ length: 12 }, (_, i) => ({
  lon: 142 + i * 0.01,
  lat: 11 + i * 0.01,
  depth: 1000 + i * 50,
}));

const CSV_CONTENT = [
  "lon,lat,depth",
  ...MOCK_POINTS.map((p) => `${p.lon},${p.lat},${p.depth}`),
].join("\n");

/** Flush pending microtasks + macrotasks so pipelines advance as far as they can. */
async function settle(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = TEST_BUCKET;
  vi.mocked(parseXyzCsv).mockReturnValue(MOCK_POINTS);
  gcsMocks.mockCreateReadStream.mockReset();
});

afterEach(() => {
  delete process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processObject — concurrency cap", () => {
  it("never runs more than PROCESS_CONCURRENCY_CAP pipelines at once, and all objects complete", async () => {
    const N = 10;
    expect(N).toBeGreaterThan(PROCESS_CONCURRENCY_CAP);

    let current = 0;
    let peak = 0;
    const releaseQueue: Array<() => void> = [];

    gcsMocks.mockCreateReadStream.mockImplementation(() => {
      current++;
      peak = Math.max(peak, current);
      const stream = new Readable({ read() {} });
      releaseQueue.push(() => {
        current--;
        stream.push(CSV_CONTENT);
        stream.push(null);
      });
      return stream;
    });

    const keys = Array.from(
      { length: N },
      (_, i) => `pending-datasets/user_burst/uuid-${i}/survey-${i}.csv`,
    );

    const pipelines = keys.map((key) =>
      processObject(TEST_BUCKET, key).catch(() => undefined),
    );

    // Every job is registered immediately (dedupe map preserved) even while queued.
    for (const key of keys) {
      expect(getJobByObjectKey(key)).toBeDefined();
    }

    // Only the first CAP downloads may start while all gates are held.
    await settle();
    expect(gcsMocks.mockCreateReadStream).toHaveBeenCalledTimes(PROCESS_CONCURRENCY_CAP);
    expect(current).toBe(PROCESS_CONCURRENCY_CAP);

    // Release gates one at a time until every pipeline has been let through.
    let released = 0;
    while (released < N) {
      while (releaseQueue.length > 0) {
        const release = releaseQueue.shift()!;
        release();
        released++;
        await settle();
        expect(peak).toBeLessThanOrEqual(PROCESS_CONCURRENCY_CAP);
      }
      await settle();
    }

    await Promise.all(pipelines);

    expect(peak).toBe(PROCESS_CONCURRENCY_CAP);
    expect(gcsMocks.mockCreateReadStream).toHaveBeenCalledTimes(N);
    for (const key of keys) {
      expect(getJobByObjectKey(key)?.status).toBe("done");
    }
  });

  it("releases the slot when a pipeline fails, so queued objects still run and errors are recorded", async () => {
    const N = PROCESS_CONCURRENCY_CAP + 2;

    // Every parse yields too few points → each pipeline fails after download.
    vi.mocked(parseXyzCsv).mockReturnValue([]);
    gcsMocks.mockCreateReadStream.mockImplementation(() => {
      const stream = new Readable({ read() {} });
      setTimeout(() => {
        stream.push(CSV_CONTENT);
        stream.push(null);
      }, 0);
      return stream;
    });

    const keys = Array.from(
      { length: N },
      (_, i) => `pending-datasets/user_fail/uuid-${i}/bad-${i}.csv`,
    );

    await Promise.all(keys.map((key) => processObject(TEST_BUCKET, key)));

    for (const key of keys) {
      const job = getJobByObjectKey(key);
      expect(job?.status).toBe("failed");
      expect(job?.error).toContain("at least 10 valid");
    }
  });
});
