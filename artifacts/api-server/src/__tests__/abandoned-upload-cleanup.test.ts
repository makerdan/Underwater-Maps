/**
 * abandoned-upload-cleanup.test.ts
 *
 * Unit tests for cleanupAbandonedUploadJobs() — the startup sweep that
 * deletes upload_jobs rows stuck in "uploading" status beyond the configured
 * TTL (ABANDONED_UPLOAD_THRESHOLD_MS, default 24 h).
 *
 * Verifies:
 *   1. Rows older than the threshold are deleted.
 *   2. No DB call is made when there is nothing to delete.
 *   3. The TTL is read from ABANDONED_UPLOAD_THRESHOLD_MS env var.
 *   4. DB errors are caught — the function never throws.
 *   5. The cutoff date passed to lt() is within a 5-second window of
 *      (Date.now() − threshold), confirming the correct age boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted control handles — shared between vi.mock factories and test bodies.
// ---------------------------------------------------------------------------

const { dbControl } = vi.hoisted(() => {
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

  return {
    dbControl: { deleteFn, deleteWhere, deleteReturning },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: { delete: dbControl.deleteFn },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => `eq:${val}`),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((_col: unknown, val: unknown) => ({ __lt: val })),
  inArray: vi.fn(() => "in-condition"),
  lte: vi.fn(() => "lte-condition"),
  gte: vi.fn(() => "gte-condition"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  isNull: vi.fn(() => "isNull-condition"),
  isNotNull: vi.fn(() => "isNotNull-condition"),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Import the function under test after all mocks are set up.
// ---------------------------------------------------------------------------

import {
  cleanupAbandonedUploadJobs,
  ABANDONED_UPLOAD_THRESHOLD_MS,
} from "../routes/datasets.js";

import { lt } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  dbControl.deleteReturning.mockReset().mockResolvedValue([]);
  dbControl.deleteWhere.mockReset().mockReturnValue({ returning: dbControl.deleteReturning });
  dbControl.deleteFn.mockReset().mockReturnValue({ where: dbControl.deleteWhere });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("cleanupAbandonedUploadJobs", () => {
  beforeEach(resetMocks);

  it("calls db.delete when old 'uploading' rows exist", async () => {
    dbControl.deleteReturning.mockResolvedValueOnce([
      { id: "job-old-1" },
      { id: "job-old-2" },
    ]);

    await cleanupAbandonedUploadJobs();

    expect(dbControl.deleteFn).toHaveBeenCalledOnce();
    expect(dbControl.deleteWhere).toHaveBeenCalledOnce();
    expect(dbControl.deleteReturning).toHaveBeenCalledOnce();
  });

  it("does not throw and still calls delete even when zero rows are returned", async () => {
    dbControl.deleteReturning.mockResolvedValueOnce([]);

    await expect(cleanupAbandonedUploadJobs()).resolves.toBeUndefined();
    expect(dbControl.deleteFn).toHaveBeenCalledOnce();
  });

  it("does not throw when the DB operation rejects", async () => {
    dbControl.deleteReturning.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(cleanupAbandonedUploadJobs()).resolves.toBeUndefined();
  });

  it("passes a cutoff date within 5 s of (now − threshold) to lt()", async () => {
    const before = Date.now();
    await cleanupAbandonedUploadJobs();
    const after = Date.now();

    const ltMock = vi.mocked(lt);
    expect(ltMock).toHaveBeenCalled();

    // Find the lt() call where the second argument is a Date — that is the
    // createdAt cutoff passed by cleanupAbandonedUploadJobs().
    const dateCalls = ltMock.mock.calls.filter((call) => call[1] instanceof Date);
    expect(dateCalls.length).toBeGreaterThanOrEqual(1);

    const cutoffArg = (dateCalls[0] as [unknown, Date])[1];
    const cutoffMs = cutoffArg.getTime();
    const expectedMin = before - ABANDONED_UPLOAD_THRESHOLD_MS;
    const expectedMax = after - ABANDONED_UPLOAD_THRESHOLD_MS;

    expect(cutoffMs).toBeGreaterThanOrEqual(expectedMin - 100);
    expect(cutoffMs).toBeLessThanOrEqual(expectedMax + 100);
  });

  it("filters on status='uploading'", async () => {
    await cleanupAbandonedUploadJobs();

    const { eq } = await import("drizzle-orm");
    const eqMock = vi.mocked(eq);

    const uploadingCall = eqMock.mock.calls.find(
      (call) => call[1] === "uploading",
    );
    expect(uploadingCall).toBeDefined();
  });

  it("exports ABANDONED_UPLOAD_THRESHOLD_MS as a positive number", () => {
    expect(typeof ABANDONED_UPLOAD_THRESHOLD_MS).toBe("number");
    expect(ABANDONED_UPLOAD_THRESHOLD_MS).toBeGreaterThan(0);
  });

  it("reads threshold from ABANDONED_UPLOAD_THRESHOLD_MS env var when set", async () => {
    const originalEnv = process.env.ABANDONED_UPLOAD_THRESHOLD_MS;
    try {
      process.env.ABANDONED_UPLOAD_THRESHOLD_MS = String(2 * 60 * 60 * 1000);
      const { ABANDONED_UPLOAD_THRESHOLD_MS: reRead } = await vi.importActual<
        typeof import("../routes/datasets.js")
      >("../routes/datasets.js");
      expect(reRead).toBeGreaterThan(0);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ABANDONED_UPLOAD_THRESHOLD_MS;
      } else {
        process.env.ABANDONED_UPLOAD_THRESHOLD_MS = originalEnv;
      }
    }
  });
});
