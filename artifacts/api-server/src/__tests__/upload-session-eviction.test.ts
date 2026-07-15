/**
 * upload-session-eviction.test.ts
 *
 * Unit tests for sweepStaleUploadSessions() — the periodic in-memory sweep
 * that evicts abandoned upload sessions/job entries from the module-level
 * Maps and deletes their temp chunk files.
 *
 * Verifies:
 *   1. A session idle beyond ABANDONED_UPLOAD_THRESHOLD_MS is evicted and
 *      its on-disk chunk files are deleted.
 *   2. A recently-active session is preserved.
 *   3. A stale-looking session that is mid-finalize is preserved (and its
 *      activity timestamp refreshed).
 *   4. A stale-looking session whose job is queued/processing is preserved.
 *   5. Terminal (done/error) uploadJobs entries are evicted after the TTL;
 *      queued/processing entries never are.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Module mocks (same scaffold as abandoned-upload-cleanup.test.ts)
// ---------------------------------------------------------------------------

const { dbControl } = vi.hoisted(() => {
  const deleteReturning = vi.fn().mockResolvedValue([]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
  return { dbControl: { deleteFn, deleteWhere, deleteReturning } };
});

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
// Import after mocks
// ---------------------------------------------------------------------------

import {
  sweepStaleUploadSessions,
  setUploadSessionForTest,
  getUploadSessionForTest,
  setUploadJobForTest,
  getUploadJobForTest,
  ABANDONED_UPLOAD_THRESHOLD_MS,
} from "../routes/datasets.js";

const CHUNK_BASE_DIR = path.join(os.tmpdir(), "bathyscan-chunks");

const STALE = Date.now() - ABANDONED_UPLOAD_THRESHOLD_MS - 60_000;
const FRESH = Date.now() - 1_000;

let idCounter = 0;
function uid(prefix: string): string {
  return `${prefix}-evict-test-${process.pid}-${++idCounter}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("sweepStaleUploadSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evicts a stale session and deletes its chunk files", async () => {
    const uploadId = uid("stale");
    await fs.promises.mkdir(CHUNK_BASE_DIR, { recursive: true });
    const chunk0 = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-0`);
    const chunk1 = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-1`);
    await fs.promises.writeFile(chunk0, "aaa");
    await fs.promises.writeFile(chunk1, "bbb");

    setUploadSessionForTest(uploadId, { userId: "user-1", lastActivityAt: STALE });

    await sweepStaleUploadSessions();

    expect(getUploadSessionForTest(uploadId)).toBeUndefined();
    await expect(fs.promises.access(chunk0)).rejects.toThrow();
    await expect(fs.promises.access(chunk1)).rejects.toThrow();
  });

  it("preserves a recently-active session and its chunk files", async () => {
    const uploadId = uid("fresh");
    await fs.promises.mkdir(CHUNK_BASE_DIR, { recursive: true });
    const chunk0 = path.join(CHUNK_BASE_DIR, `${uploadId}-chunk-0`);
    await fs.promises.writeFile(chunk0, "aaa");

    setUploadSessionForTest(uploadId, { userId: "user-1", lastActivityAt: FRESH });

    await sweepStaleUploadSessions();

    expect(getUploadSessionForTest(uploadId)).toBeDefined();
    await expect(fs.promises.access(chunk0)).resolves.toBeUndefined();

    await fs.promises.unlink(chunk0).catch(() => undefined);
  });

  it("never evicts a session that is mid-finalize, even with a stale timestamp", async () => {
    const uploadId = uid("finalizing");
    setUploadSessionForTest(uploadId, {
      userId: "user-1",
      lastActivityAt: STALE,
      finalizing: true,
    });

    await sweepStaleUploadSessions();

    const session = getUploadSessionForTest(uploadId);
    expect(session).toBeDefined();
    // Activity timestamp was refreshed so it won't be evicted next sweep either.
    expect(session!.lastActivityAt).toBeGreaterThan(STALE);
  });

  it("never evicts a session whose job is queued or processing", async () => {
    for (const status of ["queued", "processing"] as const) {
      const uploadId = uid(`active-${status}`);
      const jobId = uid(`job-${status}`);
      setUploadJobForTest(jobId, { status, progress: 10, userId: "user-1" });
      setUploadSessionForTest(uploadId, {
        userId: "user-1",
        lastActivityAt: STALE,
        activeJobId: jobId,
      });

      await sweepStaleUploadSessions();

      expect(getUploadSessionForTest(uploadId)).toBeDefined();
      // The active job itself is also preserved.
      expect(getUploadJobForTest(jobId)).toBeDefined();
    }
  });

  it("evicts a session whose job already finished (done) when idle past TTL", async () => {
    const uploadId = uid("done-session");
    const jobId = uid("done-job");
    setUploadJobForTest(jobId, { status: "done", progress: 100, userId: "user-1" });
    setUploadSessionForTest(uploadId, {
      userId: "user-1",
      lastActivityAt: STALE,
      activeJobId: jobId,
    });

    await sweepStaleUploadSessions();

    expect(getUploadSessionForTest(uploadId)).toBeUndefined();
  });

  it("evicts terminal job entries after the TTL but keeps active ones", async () => {
    const doneJobId = uid("terminal-done");
    const errorJobId = uid("terminal-error");
    const queuedJobId = uid("still-queued");

    setUploadJobForTest(doneJobId, { status: "done", progress: 100, userId: "u", lastActivityAt: STALE });
    setUploadJobForTest(errorJobId, { status: "error", progress: 0, userId: "u", lastActivityAt: STALE });
    setUploadJobForTest(queuedJobId, { status: "queued", progress: 0, userId: "u", lastActivityAt: STALE });

    await sweepStaleUploadSessions();

    expect(getUploadJobForTest(doneJobId)).toBeUndefined();
    expect(getUploadJobForTest(errorJobId)).toBeUndefined();
    expect(getUploadJobForTest(queuedJobId)).toBeDefined();
  });

  it("starts the idle clock for terminal jobs with no timestamp instead of evicting immediately", async () => {
    const jobId = uid("no-timestamp");
    setUploadJobForTest(jobId, { status: "done", progress: 100, userId: "u" });

    await sweepStaleUploadSessions();

    const job = getUploadJobForTest(jobId);
    expect(job).toBeDefined();
    expect(job!.lastActivityAt).toBeTypeOf("number");
  });
});
