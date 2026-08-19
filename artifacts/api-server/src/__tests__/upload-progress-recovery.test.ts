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
 *  3. GET /datasets/upload/chunk/status/:uploadId never invents received chunk
 *     indices from the DB aggregate when /tmp is empty after a restart.
 *
 * All three scenarios live here so they are easy to find alongside the
 * existing multer-chunk-limit tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import request from "supertest";

// ── DB mock with per-test configurable select result and call spies ───────────

const {
  mockDbSelectResult,
  insertOnConflictDoNothingSpy,
  insertReturningSpy,
  insertValuesSpy,
  updateSetWhereSpy,
  updateSetSpy,
} = vi.hoisted(() => {
  const insertOnConflictDoNothingSpy = vi.fn().mockResolvedValue([]);
  const insertReturningSpy = vi.fn().mockResolvedValue([]);
  const insertOnConflictDoUpdateSpy = vi.fn().mockResolvedValue([]);
  const insertValuesSpy = vi.fn(() => ({
    onConflictDoNothing: insertOnConflictDoNothingSpy,
    onConflictDoUpdate: insertOnConflictDoUpdateSpy,
    returning: insertReturningSpy,
  }));
  const updateSetWhereSpy = vi.fn().mockImplementation(() => ({
    returning: vi.fn().mockResolvedValue([{ id: "queued-upload-job" }]),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve([]).catch(reject),
    finally: (fn: () => void) => Promise.resolve([]).finally(fn),
  }));
  const updateSetSpy = vi.fn(() => ({
    where: updateSetWhereSpy,
  }));
  return {
    mockDbSelectResult: { current: [] as unknown[] },
    insertOnConflictDoNothingSpy,
    insertReturningSpy,
    insertValuesSpy,
    updateSetWhereSpy,
    updateSetSpy,
  };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: () => ({
          where: () => Promise.resolve(mockDbSelectResult.current),
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: insertValuesSpy,
      })),
      update: vi.fn().mockImplementation(() => ({
        set: updateSetSpy,
      })),
    },
  });
});

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
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

const E2E_USER = "user_progress_recovery_test";
const SMALL_CHUNK = Buffer.alloc(512, 0x42);

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  mockDbSelectResult.current = [];
  insertValuesSpy.mockClear();
  insertOnConflictDoNothingSpy.mockClear();
  insertReturningSpy.mockClear();
  updateSetSpy.mockClear();
  updateSetWhereSpy.mockClear();
});

describe("Upload progress recovery — DB-backed session tracking", () => {
  it("chunk 0 inserts an 'uploading' DB row with chunksReceived = 1", async () => {
    const startRes = await request(app)
      .post("/api/datasets/upload/start")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER);
    expect(startRes.status).toBe(200);
    const uploadId = (startRes.body as { uploadId: string }).uploadId;

    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 0 });

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

  it("chunk N > 0 persists the exact number of chunk files on disk", async () => {
    const startRes2 = await request(app)
      .post("/api/datasets/upload/start")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER);
    expect(startRes2.status).toBe(200);
    const uploadId = (startRes2.body as { uploadId: string }).uploadId;

    // Send chunk 0 first to create the in-memory session.
    const res0 = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res0.status).toBe(200);

    // Reset the update spy so we only count the call from chunk 1.
    updateSetSpy.mockClear();
    updateSetWhereSpy.mockClear();

    // Send chunk 2 out of order. Exactly two files now exist (0 and 2), so the
    // DB aggregate must be 2 rather than the high-water value 3.
    const res1 = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "2")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.csv");

    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({ received: 2 });

    expect(updateSetSpy).toHaveBeenCalledOnce();

    const setValues = (updateSetSpy.mock.calls as unknown as Array<[Record<string, unknown>]>)[0]![0]!;
    expect(setValues).toMatchObject({ chunksReceived: 2 });
  });

  it("GET chunk/status returns [] when disk is empty after restart", async () => {
    // Use an uploadId that was never sent to the chunk endpoint in this test
    // run, so the in-memory uploadSessions map has no entry for it.  This
    // simulates a server restart where the map was cleared.
    const uploadId = `recovery-test-status-${Date.now()}`;

    // Seed the DB mock so the select fallback returns a row for this uploadId.
    mockDbSelectResult.current = [
      {
        userId: E2E_USER,
        chunksReceived: 4,
        sessionJobId: "mock-session-job-id-abc123",
        status: "uploading",
        totalChunks: 4,
      },
    ];

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uploadId });

    expect(res.body.receivedChunks).toEqual([]);
    expect(res.body.lifecycleStatus).toBe("uploading");
  });

  it("chunk N > 0 is accepted via DB fallback without requiring chunk 0 to be re-sent (simulated restart)", async () => {
    // Use an uploadId that was never sent in this process — simulates the
    // state after a server restart where the in-memory uploadSessions map is
    // empty but the DB still has the "uploading" row from the original chunk 0.
    const uploadId = `recovery-test-resume-direct-${Date.now()}`;

    // Seed the DB mock to return a valid row for this uploadId.  The chunk
    // handler's DB fallback selects { userId, sessionJobId } from upload_jobs.
    mockDbSelectResult.current = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-id-resume",
        chunksReceived: 1,
        status: "uploading",
        totalChunks: 3,
      },
    ];

    // Send chunk 1 without having sent chunk 0 in this process.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
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
    mockDbSelectResult.current = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-finalize",
        status: "uploading",
        totalChunks: 1,
      },
    ];

    // All chunk file paths must appear to exist so the pre-finalize disk check
    // passes.  Spy on fs.promises.access and always resolve it.
    const accessSpy = vi
      .spyOn(fs.promises, "access")
      .mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
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

    mockDbSelectResult.current = [
      {
        userId: E2E_USER,
        sessionJobId: "mock-session-job-id-roundtrip",
        chunksReceived: 1,
        status: "uploading",
        totalChunks: 3,
      },
    ];

    // Step 2: client calls GET chunk/status after reconnecting — this is the
    // first thing the resume flow does.  The handler re-hydrates the
    // in-memory session from the DB row so subsequent chunk POSTs are accepted
    // without touching the DB again.
    const statusRes = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER);

    expect(statusRes.status).toBe(200);
    // No chunk file exists on disk, so the safe answer is [] even though the
    // aggregate DB count says one chunk was received before restart.
    expect(statusRes.body.receivedChunks).toEqual([]);

    // Step 3: send chunk 1 — this should now hit the in-memory fast path
    // (session was restored by the status call above).  No DB select needed.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-bypass-secret", "vitest-test-secret")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", uploadId)
      .field("chunkIndex", "1")
      .field("totalChunks", "3")
      .attach("file", SMALL_CHUNK, "data.bin");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 1 });
  });
});
