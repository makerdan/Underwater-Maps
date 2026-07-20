/**
 * bucket-monitor-lifecycle.test.ts
 *
 * Tests for the 403 graceful-degradation path in applyBucketLifecycleRules().
 *
 * When the Replit-managed GCS service account lacks storage.buckets.get /
 * storage.buckets.update permissions, the function must:
 *   ✓ Resolve (not throw) so the scan loop is unaffected
 *   ✓ Set lifecycleApplyStatus.permissionDenied = true
 *   ✓ Log at INFO level (not WARN)
 *   ✓ Re-throw any non-403 error
 *   ✓ Apply rules and set appliedAt on the success path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── GCS mock ─────────────────────────────────────────────────────────────────

const gcsMocks = vi.hoisted(() => {
  const mockGetMetadata = vi.fn();
  const mockSetMetadata = vi.fn().mockResolvedValue(undefined);

  const mockBucket = vi.fn().mockReturnValue({
    getMetadata: mockGetMetadata,
    setMetadata: mockSetMetadata,
  });

  return { mockGetMetadata, mockSetMetadata, mockBucket };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(() => ({
    bucket: gcsMocks.mockBucket,
  })),
}));

// ── Minimal stubs for transitive imports ─────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
});

vi.mock("../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: [],
  NYSDEC_BATHY_FEATURE_SERVICE: "https://mock.invalid/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://mock.invalid/mndnr",
  parseXyzCsv: vi.fn(),
  gridPoints: vi.fn(),
  ALL_PRESET_DATASETS: [],
  buildTerrainGrid: vi.fn(),
  previewDataset: vi.fn(),
  previewBboxForDownload: vi.fn(),
  buildBboxCsvRows: vi.fn(),
}));

vi.mock("../lib/uploadParsers.js", () => ({ parseUploadedFile: vi.fn() }));

// ── Logger spy ───────────────────────────────────────────────────────────────

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({ logger: loggerMock }));

// ── Module under test ────────────────────────────────────────────────────────

import {
  applyBucketLifecycleRules,
  getLifecycleApplyStatus,
} from "../lib/bucketMonitor.js";

// ─────────────────────────────────────────────────────────────────────────────

const TEST_BUCKET = "test-lifecycle-bucket";

beforeEach(() => {
  process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"] = TEST_BUCKET;
  gcsMocks.mockGetMetadata.mockReset();
  gcsMocks.mockSetMetadata.mockReset();
  gcsMocks.mockSetMetadata.mockResolvedValue(undefined);
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// 403 path
// ─────────────────────────────────────────────────────────────────────────────

describe("applyBucketLifecycleRules — 403 permission-denied path", () => {
  function make403() {
    const err = Object.assign(new Error("does not have storage.buckets.get access"), { code: 403 });
    gcsMocks.mockGetMetadata.mockRejectedValueOnce(err);
  }

  it("resolves (does not throw) when getMetadata returns 403", async () => {
    make403();
    await expect(applyBucketLifecycleRules()).resolves.toBeUndefined();
  });

  it("sets permissionDenied=true in getLifecycleApplyStatus()", async () => {
    make403();
    await applyBucketLifecycleRules();
    const status = getLifecycleApplyStatus();
    expect(status.permissionDenied).toBe(true);
    expect(status.error).toBeNull();
    expect(status.appliedAt).toBeNull();
  });

  it("logs at INFO level (not WARN) when 403 is received", async () => {
    make403();
    await applyBucketLifecycleRules();
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: TEST_BUCKET }),
      expect.stringContaining("[bucket-monitor] lifecycle rules cannot be managed"),
    );
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("does not call setMetadata when getMetadata returns 403", async () => {
    make403();
    await applyBucketLifecycleRules();
    expect(gcsMocks.mockSetMetadata).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-403 error path — must re-throw
// ─────────────────────────────────────────────────────────────────────────────

describe("applyBucketLifecycleRules — non-403 error path", () => {
  it("re-throws a non-403 GCS error (e.g. network timeout)", async () => {
    const networkErr = Object.assign(new Error("Connection reset"), { code: 503 });
    gcsMocks.mockGetMetadata.mockRejectedValueOnce(networkErr);
    await expect(applyBucketLifecycleRules()).rejects.toThrow("Connection reset");
  });

  it("re-throws an error with no code property", async () => {
    gcsMocks.mockGetMetadata.mockRejectedValueOnce(new Error("unknown failure"));
    await expect(applyBucketLifecycleRules()).rejects.toThrow("unknown failure");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Success path — baseline sanity check
// ─────────────────────────────────────────────────────────────────────────────

describe("applyBucketLifecycleRules — success path", () => {
  it("sets appliedAt and clears error/permissionDenied on success", async () => {
    gcsMocks.mockGetMetadata.mockResolvedValueOnce([
      { lifecycle: { rule: [] } },
    ]);

    const before = Date.now();
    await applyBucketLifecycleRules();
    const after = Date.now();

    const status = getLifecycleApplyStatus();
    expect(status.appliedAt).toBeGreaterThanOrEqual(before);
    expect(status.appliedAt).toBeLessThanOrEqual(after);
    expect(status.error).toBeNull();
    expect(status.permissionDenied).toBeFalsy();
  });

  it("calls setMetadata with lifecycle rules on success", async () => {
    gcsMocks.mockGetMetadata.mockResolvedValueOnce([
      { lifecycle: { rule: [] } },
    ]);

    await applyBucketLifecycleRules();

    expect(gcsMocks.mockSetMetadata).toHaveBeenCalledOnce();
    const [arg] = gcsMocks.mockSetMetadata.mock.calls[0] as [{ lifecycle: { rule: unknown[] } }];
    expect(arg).toHaveProperty("lifecycle.rule");
    expect(Array.isArray(arg.lifecycle.rule)).toBe(true);
    expect(arg.lifecycle.rule.length).toBeGreaterThan(0);
  });
});
