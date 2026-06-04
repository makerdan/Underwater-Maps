/**
 * upload-progress-recovery.test.ts
 *
 * Covers the DB-backed upload session tracking that makes chunk uploads
 * resumable after a server restart:
 *
 *  1. Chunk 0 triggers createUploadSessionRow — inserts an "uploading" DB row
 *     with chunksReceived = 1.
 *  2. A subsequent chunk triggers updateChunksReceivedInDB — updates the row
 *     with the new chunksReceived count.
 *  3. GET /datasets/upload/chunk/status/:uploadId synthesises receivedChunks
 *     from DB when the disk directory is empty (post-restart state where /tmp
 *     has been wiped but the DB row persists).
 *
 * All three scenarios live here so they are easy to find alongside the
 * existing multer-chunk-limit tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock with per-test configurable select result and call spies ───────────

let mockDbSelectResult: unknown[] = [];

const insertOnConflictDoNothingSpy = vi.fn().mockResolvedValue([]);
const insertReturningSpy = vi.fn().mockResolvedValue([]);
const insertValuesSpy = vi.fn(() => ({
  onConflictDoNothing: insertOnConflictDoNothingSpy,
  returning: insertReturningSpy,
}));

const updateSetWhereSpy = vi.fn().mockResolvedValue([]);
const updateSetSpy = vi.fn(() => ({
  where: updateSetWhereSpy,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockDbSelectResult),
      }),
    }),
    insert: () => ({
      values: insertValuesSpy,
    }),
    update: () => ({
      set: updateSetSpy,
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
  pool: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const E2E_USER = "user_progress_recovery_test";
const SMALL_CHUNK = Buffer.alloc(512, 0x42);

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  mockDbSelectResult = [];
  insertValuesSpy.mockClear();
  insertOnConflictDoNothingSpy.mockClear();
  insertReturningSpy.mockClear();
  updateSetSpy.mockClear();
  updateSetWhereSpy.mockClear();
});

describe("Upload progress recovery — DB-backed session tracking", () => {
  it("chunk 0 inserts an 'uploading' DB row with chunksReceived = 1", async () => {
    const uploadId = `recovery-test-chunk0-${Date.now()}`;

    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 0 });

    // createUploadSessionRow fires-and-forgets — give the microtask queue a
    // tick to flush the async DB call before asserting on the spy.
    await new Promise((r) => setTimeout(r, 50));

    expect(insertValuesSpy).toHaveBeenCalledOnce();

    const insertedValues = (insertValuesSpy.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    expect(insertedValues).toMatchObject({
      status: "uploading",
      userId: E2E_USER,
      uploadId,
      totalChunks: 3,
      chunksReceived: 1,
      progress: 0,
    });
  });

  it("chunk N > 0 calls updateChunksReceivedInDB with chunkIndex + 1", async () => {
    const uploadId = `recovery-test-chunk1-${Date.now()}`;

    // Send chunk 0 first to create the in-memory session.
    const res0 = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res0.status).toBe(200);

    // Reset the update spy so we only count the call from chunk 1.
    updateSetSpy.mockClear();
    updateSetWhereSpy.mockClear();

    // Send chunk 1 — this should call updateChunksReceivedInDB(uploadId, 2).
    const res1 = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "1")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ received: 1 });

    // updateChunksReceivedInDB is fire-and-forget — flush microtasks.
    await new Promise((r) => setTimeout(r, 50));

    expect(updateSetSpy).toHaveBeenCalledOnce();

    const setValues = (updateSetSpy.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    // chunkIndex 1 → chunksReceived = chunkIndex + 1 = 2
    expect(setValues).toMatchObject({ chunksReceived: 2 });
  });

  it("GET chunk/status synthesises receivedChunks from DB when disk is empty (post-restart)", async () => {
    // Use an uploadId that was never sent to the chunk endpoint in this test
    // run, so the in-memory uploadSessions map has no entry for it.  This
    // simulates a server restart where the map was cleared.
    const uploadId = `recovery-test-status-${Date.now()}`;

    // Seed the DB mock so the select fallback returns a row for this uploadId.
    mockDbSelectResult = [
      {
        userId: E2E_USER,
        chunksReceived: 4,
        sessionJobId: "mock-session-job-id-abc123",
      },
    ];

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uploadId });

    // The synthesised list should be [0, 1, 2, 3] — one entry per
    // chunksReceived (DB fallback for wiped /tmp).
    expect(res.body.receivedChunks).toEqual([0, 1, 2, 3]);
  });
});
