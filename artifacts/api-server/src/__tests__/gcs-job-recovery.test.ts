/**
 * gcs-job-recovery.test.ts
 *
 * Unit tests for recoverGcsJobStatus() in bucketMonitor.ts.
 *
 * Coverage:
 *   ✓ failed-datasets/ present → returns { status: "failed", error: "<msg>" }
 *   ✓ failed-datasets/ present without error metadata → { status: "failed" }
 *   ✓ processed-datasets/ present (no failed) → { status: "complete" }
 *   ✓ pending-datasets/ present only → { status: "pending" }
 *   ✓ object not found in any prefix → { status: "unknown" }
 *   ✓ 30-second cache: second call returns cached result without hitting GCS
 *   ✓ cache expires after TTL: GCS is re-queried after 30 s
 *
 * All GCS I/O is replaced by vi.mock stubs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── GCS mock ──────────────────────────────────────────────────────────────────
// mockGetMetadata is keyed by object name so each file can return different
// behaviour in the same test.

const gcsMocks = vi.hoisted(() => {
  const mockGetMetadata = vi.fn();

  const mockFile = vi.fn().mockImplementation((name: string) => ({
    name,
    getMetadata: () => mockGetMetadata(name),
  }));

  const mockBucket = vi.fn().mockReturnValue({ file: mockFile });

  return { mockGetMetadata, mockFile, mockBucket };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: gcsMocks.mockBucket,
  })),
}));

// ── DB mock (bucketMonitor imports @workspace/db for the dataset insert) ──────
vi.mock("@workspace/db", () => ({
  db: { insert: vi.fn() },
  customDatasetsTable: {},
}));

// ── logger mock ───────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── terrain / parsers mocks ───────────────────────────────────────────────────
vi.mock("../lib/terrain.js", () => ({
  parseXyzCsv: vi.fn(),
  gridPoints: vi.fn(),
}));
vi.mock("../lib/uploadParsers.js", () => ({ parseUploadedFile: vi.fn() }));

// ── cacheRegistry mock ────────────────────────────────────────────────────────
vi.mock("../lib/cacheRegistry.js", () => ({ registerCache: vi.fn() }));

// ── Import after all mocks ────────────────────────────────────────────────────
import { recoverGcsJobStatus } from "../lib/bucketMonitor.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUCKET_ID = "test-bucket";
const OBJECT_KEY = "pending-datasets/user_abc/uuid-001/survey.csv";
const SUFFIX = "user_abc/uuid-001/survey.csv";

/** Make getMetadata resolve for the given key, reject for all others. */
function onlyExists(key: string, metadata: Record<string, unknown> = {}): void {
  gcsMocks.mockGetMetadata.mockImplementation((name: string) => {
    if (name === key) return Promise.resolve([metadata]);
    return Promise.reject(new Error("404 Not Found"));
  });
}

/** Make getMetadata reject for every key (object not found anywhere). */
function noneExist(): void {
  gcsMocks.mockGetMetadata.mockRejectedValue(new Error("404 Not Found"));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("recoverGcsJobStatus", () => {
  beforeEach(() => {
    process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = BUCKET_ID;
    gcsMocks.mockGetMetadata.mockReset();
    vi.useFakeTimers();
    // Advance past the 30-second cache TTL so prior test entries are always
    // expired at the start of each test — prevents cross-test cache pollution.
    vi.advanceTimersByTime(31_000);
  });

  it("returns status=failed with error when object is in failed-datasets/ with x-goog-meta-error", async () => {
    onlyExists(`failed-datasets/${SUFFIX}`, {
      metadata: { "x-goog-meta-error": "File must contain at least 10 valid rows" },
    });

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result).toEqual({
      status: "failed",
      error: "File must contain at least 10 valid rows",
    });
  });

  it("returns status=failed without error field when x-goog-meta-error is absent", async () => {
    onlyExists(`failed-datasets/${SUFFIX}`, { metadata: {} });

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result.status).toBe("failed");
    expect(result).not.toHaveProperty("error");
  });

  it("returns status=complete when object is in processed-datasets/ only", async () => {
    onlyExists(`processed-datasets/${SUFFIX}`);

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result).toEqual({ status: "complete" });
  });

  it("returns status=pending when object is still in pending-datasets/ only", async () => {
    onlyExists(OBJECT_KEY);

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result).toEqual({ status: "pending" });
  });

  it("returns status=unknown when object is not found in any prefix", async () => {
    noneExist();

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result).toEqual({ status: "unknown" });
  });

  it("prefers failed-datasets/ over processed-datasets/", async () => {
    gcsMocks.mockGetMetadata.mockImplementation((name: string) => {
      if (name === `failed-datasets/${SUFFIX}`) {
        return Promise.resolve([{ metadata: { "x-goog-meta-error": "parse error" } }]);
      }
      if (name === `processed-datasets/${SUFFIX}`) {
        return Promise.resolve([{}]);
      }
      return Promise.reject(new Error("404 Not Found"));
    });

    const result = await recoverGcsJobStatus(OBJECT_KEY);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("parse error");
  });

  it("caches the result for 30 seconds and does not hit GCS on second call", async () => {
    onlyExists(`failed-datasets/${SUFFIX}`, {
      metadata: { "x-goog-meta-error": "cached error" },
    });

    const first = await recoverGcsJobStatus(OBJECT_KEY);
    const callCountAfterFirst = gcsMocks.mockGetMetadata.mock.calls.length;

    // Second call within TTL — should use cache
    const second = await recoverGcsJobStatus(OBJECT_KEY);

    expect(second).toEqual(first);
    expect(gcsMocks.mockGetMetadata.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("re-queries GCS after the 30-second cache TTL expires", async () => {
    onlyExists(`processed-datasets/${SUFFIX}`);

    const first = await recoverGcsJobStatus(OBJECT_KEY);
    expect(first.status).toBe("complete");

    const callCountAfterFirst = gcsMocks.mockGetMetadata.mock.calls.length;

    // Advance time past the 30-second TTL
    vi.advanceTimersByTime(31_000);

    // Now object has moved to failed
    gcsMocks.mockGetMetadata.mockImplementation((name: string) => {
      if (name === `failed-datasets/${SUFFIX}`) {
        return Promise.resolve([{ metadata: { "x-goog-meta-error": "late failure" } }]);
      }
      return Promise.reject(new Error("404 Not Found"));
    });

    const second = await recoverGcsJobStatus(OBJECT_KEY);

    expect(second.status).toBe("failed");
    expect(gcsMocks.mockGetMetadata.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
  });
});
