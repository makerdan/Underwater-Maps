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
import fs from "fs";
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

  it("chunk N > 0 is accepted via DB fallback without requiring chunk 0 to be re-sent (simulated restart)", async () => {
    // Use an uploadId that was never sent in this process — simulates the
    // state after a server restart where the in-memory uploadSessions map is
    // empty but the DB still has the "uploading" row from the original chunk 0.
    const uploadId = `recovery-test-resume-direct-${Date.now()}`;

    // Seed the DB mock to return a valid row for this uploadId.  The chunk
    // handler's DB fallback selects { userId, sessionJobId } from upload_jobs.
    mockDbSelectResult = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-id-resume",
        chunksReceived: 1,
      },
    ];

    // Send chunk 1 without having sent chunk 0 in this process.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "1")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.bin");

    // The handler must accept the chunk (200) rather than returning 404
    // session_not_found, because it falls back to the DB row.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 1 });
  });

  it("finalize succeeds via DB fallback when in-memory session is absent (simulated restart)", async () => {
    // Use an uploadId never sent in this process so the in-memory uploadSessions
    // map has no entry for it — simulating a server restart between the last
    // chunk arriving and finalize being called.
    const uploadId = `finalize-recovery-${Date.now()}`;

    // Seed the DB mock so the fallback returns a valid session row.
    mockDbSelectResult = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-finalize",
      },
    ];

    // All chunk file paths must appear to exist so the pre-finalize disk check
    // passes.  Spy on fs.promises.access and always resolve it.
    const accessSpy = vi
      .spyOn(fs.promises, "access")
      .mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", E2E_USER)
      .send({ uploadId, fileName: "test.csv", totalChunks: 1, resolution: 256 })
      .set("Content-Type", "application/json");

    accessSpy.mockRestore();

    // The finalize route must succeed (200 + jobId) even though no in-memory
    // session existed — because it recovered the session from the DB row.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("jobId");
  });

  it("full round-trip: chunk 0 → restart → status re-hydrates → chunk N accepted", async () => {
    // Step 1: use a fresh uploadId to simulate the "pre-restart" state where
    // chunk 0 was sent in a previous server lifetime.  The in-memory session
    // map is empty for this ID (we never actually send chunk 0 here), but the
    // DB row is seeded to represent the persisted state left by chunk 0.
    const uploadId = `recovery-test-roundtrip-${Date.now()}`;

    mockDbSelectResult = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-id-roundtrip",
        chunksReceived: 1,
      },
    ];

    // Step 2: client calls GET chunk/status after reconnecting — this is the
    // first thing the resume flow does.  The handler re-hydrates the
    // in-memory session from the DB row so subsequent chunk POSTs are accepted
    // without touching the DB again.
    const statusRes = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set("x-e2e-user-id", E2E_USER);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.receivedChunks).toEqual([0]); // chunksReceived = 1 → index 0

    // Step 3: send chunk 1 — this should now hit the in-memory fast path
    // (session was restored by the status call above).  No DB select needed.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "1")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.bin");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 1 });
  });
});
