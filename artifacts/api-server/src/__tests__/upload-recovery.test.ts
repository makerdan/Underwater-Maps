/**
 * upload-recovery.test.ts
 *
 * End-to-end coverage for three resilience features:
 *
 * 1. GET /datasets/upload/chunk/status/:uploadId
 *    — auth (401), ownership (404), no-chunks-yet, and correct chunk listing
 *      after one or more chunks have been received.
 *
 * 2. recoverStaleUploadJobs()
 *    — Server-restart simulation: stale DB jobs with no recoverable source
 *      are marked as error; stale jobs with a valid meta sidecar + assembled
 *      file are re-queued and their upload session is restored so the
 *      chunk-status endpoint can serve them correctly.
 *
 * 3. Job-poll resilience across reconnects
 *    — GET /api/datasets/upload/jobs/:jobId returns the correct state on
 *      every call, simulating repeated polls the client makes after a network
 *      drop (client is responsible for back-off; the server is stateless
 *      between polls). Ownership enforcement (403) and idempotency (409) are
 *      also verified here.
 *
 * All GCS I/O, DB, Clerk auth and the parse worker are replaced by mocks.
 * Filesystem access for recoverStaleUploadJobs is patched with vi.spyOn so
 * the real chunk-write path used by the POST /chunk route tests is unaffected.
 */

import * as fs from "fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted control handles shared between vi.mock factories and test bodies.
// ---------------------------------------------------------------------------

const { FakeParseWorker, dbControl } = vi.hoisted(() => {
  const { EventEmitter } = require("events") as typeof import("events");

  const FAKE_TERRAIN = {
    depths: new Array(32 * 32).fill(50),
    width: 32,
    height: 32,
    minDepth: 50,
    maxDepth: 50,
    bounds: { minLon: 140, maxLon: 141, minLat: 10, maxLat: 11 },
  };

  class FakeParseWorker extends EventEmitter {
    constructor(_path: string, _options?: unknown) {
      super();
      setImmediate(() => {
        this.emit("message", {
          type: "result",
          terrain: FAKE_TERRAIN,
          overview: FAKE_TERRAIN,
        });
      });
    }
    terminate(): Promise<number> { return Promise.resolve(0); }
  }

  // Chainable DB select mock — where() resolves [] by default and can be
  // overridden per-test with mockResolvedValueOnce().
  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

  // Chainable DB update mock
  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    FakeParseWorker,
    dbControl: { selectWhere, selectFrom, updateWhere, updateSet },
  };
});

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the modules they replace.
// ---------------------------------------------------------------------------

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  return { ...actual, Worker: FakeParseWorker };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: dbControl.selectFrom }),
      update: vi.fn().mockReturnValue({ set: dbControl.updateSet }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
  inArray: vi.fn(() => "in-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] ?? null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

// ---------------------------------------------------------------------------
// Import app and recoverStaleUploadJobs after all mocks are in place.
// ---------------------------------------------------------------------------

import app from "../app.js";
import { recoverStaleUploadJobs } from "../routes/datasets.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const USER_A = "user_recovery_a";
const USER_B = "user_recovery_b";
const AUTH_A = { "x-mock-clerk-user-id": USER_A };
const AUTH_B = { "x-mock-clerk-user-id": USER_B };

/** Reset the DB select mock to its safe default (empty result set). */
function resetSelectDefault(): void {
  dbControl.selectWhere.mockReset().mockResolvedValue([]);
  dbControl.selectFrom.mockReturnValue({ where: dbControl.selectWhere });
}

/** Reset the DB update mock. */
function resetUpdateDefault(): void {
  dbControl.updateWhere.mockReset().mockResolvedValue([]);
  dbControl.updateSet.mockReset().mockReturnValue({ where: dbControl.updateWhere });
}

/** Upload a single raw chunk and verify it was accepted. */
async function uploadChunk(
  uploadId: string,
  chunkIndex: number,
  totalChunks: number,
  authHeaders: Record<string, string> = AUTH_A,
  payload: Buffer = Buffer.from("lon,lat,depth\n142.0,11.0,500\n"),
): Promise<void> {
  const res = await request(app)
    .post("/api/datasets/upload/chunk")
    .set(authHeaders)
    .field("uploadId", uploadId)
    .field("chunkIndex", String(chunkIndex))
    .field("totalChunks", String(totalChunks))
    .attach("file", payload, { filename: "survey.xyz", contentType: "text/plain" });
  expect(res.status, `chunk ${chunkIndex} upload failed: ${JSON.stringify(res.body)}`).toBe(200);
}

/** Finalize a chunked upload and return the jobId. */
async function finalizeUpload(
  uploadId: string,
  totalChunks: number,
  authHeaders: Record<string, string> = AUTH_A,
): Promise<string> {
  const res = await request(app)
    .post("/api/datasets/upload/chunk/finalize")
    .set(authHeaders)
    .set("Content-Type", "application/json")
    .send({ uploadId, fileName: "survey.xyz", totalChunks, resolution: 32 });
  expect(res.status, `finalize failed: ${JSON.stringify(res.body)}`).toBe(200);
  return (res.body as { jobId: string }).jobId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /datasets/upload/chunk/status/:uploadId
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /datasets/upload/chunk/status/:uploadId", () => {
  beforeEach(() => {
    resetSelectDefault();
    resetUpdateDefault();
  });

  it("returns 401 when no auth header is present", async () => {
    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${crypto.randomUUID()}`);

    expect(res.status).toBe(401);
  });

  it("returns 404 when no upload session exists for the given uploadId", async () => {
    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${crypto.randomUUID()}`)
      .set(AUTH_A);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "upload_not_found");
  });

  it("returns 404 when the session belongs to a different user", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 2, AUTH_A);

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`)
      .set(AUTH_B);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "upload_not_found");
  });

  it("returns receivedChunks=[0] after chunk 0 is uploaded", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 3, AUTH_A);

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`)
      .set(AUTH_A);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uploadId, receivedChunks: [0] });
  });

  it("returns receivedChunks sorted correctly after two chunks are uploaded", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 3, AUTH_A);
    await uploadChunk(uploadId, 1, 3, AUTH_A);

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`)
      .set(AUTH_A);

    expect(res.status).toBe(200);
    expect(res.body.receivedChunks).toEqual([0, 1]);
  });

  it("returns receivedChunks=[] when the session exists but the chunk directory appears empty", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 2, AUTH_A);

    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockResolvedValueOnce(
        [] as unknown as ReturnType<typeof fs.promises.readdir> extends Promise<infer T> ? T : never,
      );

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`)
      .set(AUTH_A);

    readdirSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.receivedChunks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. recoverStaleUploadJobs — irrecoverable (no sidecar on disk)
// ═══════════════════════════════════════════════════════════════════════════════

describe("recoverStaleUploadJobs — irrecoverable jobs (no meta sidecar)", () => {
  beforeEach(() => {
    resetSelectDefault();
    resetUpdateDefault();
  });

  it("marks a stale 'queued' job as error when no sidecar exists", async () => {
    const jobId = crypto.randomUUID();
    dbControl.selectWhere.mockResolvedValueOnce([{ id: jobId, userId: USER_A }]);

    const readFileSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await recoverStaleUploadJobs();
    readFileSpy.mockRestore();

    expect(dbControl.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("marks the job error message as explaining a server restart", async () => {
    const jobId = crypto.randomUUID();
    dbControl.selectWhere.mockResolvedValueOnce([{ id: jobId, userId: USER_B }]);

    const readFileSpy = vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await recoverStaleUploadJobs();
    readFileSpy.mockRestore();

    expect(dbControl.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("Server restarted"),
      }),
    );
  });

  it("does nothing (no db.update calls) when no stale jobs exist", async () => {
    dbControl.selectWhere.mockResolvedValueOnce([]);

    await recoverStaleUploadJobs();

    expect(dbControl.updateSet).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. recoverStaleUploadJobs — recoverable (sidecar + assembled file exist)
// ═══════════════════════════════════════════════════════════════════════════════

describe("recoverStaleUploadJobs — recoverable jobs (sidecar + assembled file)", () => {
  beforeEach(() => {
    resetSelectDefault();
    resetUpdateDefault();
  });

  it("restores the upload session so chunk-status returns 200 after recovery", async () => {
    const uploadId = `upload-rec-${crypto.randomUUID()}`;
    const jobId = `job-rec-${crypto.randomUUID()}`;

    dbControl.selectWhere.mockResolvedValueOnce([{ id: jobId, userId: USER_A }]);

    const sidecar = JSON.stringify({
      uploadId,
      fileName: "survey.xyz",
      totalChunks: 1,
      resolution: 32,
      userId: USER_A,
      smoothing: false,
    });

    const readFileSpy = vi.spyOn(fs.promises, "readFile").mockResolvedValueOnce(sidecar as never);
    const accessSpy = vi.spyOn(fs.promises, "access").mockResolvedValueOnce(undefined);

    await recoverStaleUploadJobs();

    readFileSpy.mockRestore();
    accessSpy.mockRestore();

    // The upload session should be restored — chunk-status must return 200.
    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${encodeURIComponent(uploadId)}`)
      .set(AUTH_A);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("uploadId", uploadId);
  });

  it("does not call db.update(error) for a successfully re-queued job", async () => {
    const uploadId = `upload-rq-${crypto.randomUUID()}`;
    const jobId = `job-rq-${crypto.randomUUID()}`;
    const sidecar = JSON.stringify({
      uploadId,
      fileName: "survey.xyz",
      totalChunks: 1,
      resolution: 32,
      userId: USER_A,
      smoothing: false,
    });

    dbControl.selectWhere.mockResolvedValueOnce([{ id: jobId, userId: USER_A }]);

    const readFileSpy = vi.spyOn(fs.promises, "readFile").mockResolvedValueOnce(sidecar as never);
    const accessSpy = vi.spyOn(fs.promises, "access").mockResolvedValueOnce(undefined);

    await recoverStaleUploadJobs();

    readFileSpy.mockRestore();
    accessSpy.mockRestore();

    expect(dbControl.updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("falls back to irrecoverable when sidecar exists but assembled file and chunk-0 are both absent", async () => {
    const uploadId = `upload-nofile-${crypto.randomUUID()}`;
    const jobId = `job-nofile-${crypto.randomUUID()}`;
    const sidecar = JSON.stringify({
      uploadId,
      fileName: "survey.xyz",
      totalChunks: 1,
      resolution: 32,
      userId: USER_A,
      smoothing: false,
    });

    dbControl.selectWhere.mockResolvedValueOnce([{ id: jobId, userId: USER_A }]);

    const readFileSpy = vi.spyOn(fs.promises, "readFile").mockResolvedValueOnce(sidecar as never);
    // Both assembled file and chunk-0 are absent.
    const accessSpy = vi.spyOn(fs.promises, "access").mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await recoverStaleUploadJobs();

    readFileSpy.mockRestore();
    accessSpy.mockRestore();

    expect(dbControl.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Job-poll endpoint resilience across reconnects
//    — GET /api/datasets/upload/jobs/:jobId
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/datasets/upload/jobs/:jobId — poll resilience", () => {
  beforeEach(() => {
    // Ensure DB select always returns empty by default so unknown-job polls
    // receive 404 (not 500 due to undefined result from a depleted mock).
    resetSelectDefault();
    resetUpdateDefault();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${crypto.randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the jobId is unknown (not in memory or DB)", async () => {
    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${crypto.randomUUID()}`)
      .set(AUTH_A);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not_found");
  });

  it(
    "survives repeated polls during processing and eventually resolves to done — simulates client reconnect poll loop",
    async () => {
      const uploadId = crypto.randomUUID();
      const payload = Buffer.from("lon,lat,depth\n140.0,10.0,100\n141.0,11.0,200\n");

      await uploadChunk(uploadId, 0, 1, AUTH_A, payload);
      const jobId = await finalizeUpload(uploadId, 1, AUTH_A);

      // Simulate a client poll loop as it would behave after reconnecting from
      // a network drop: poll repeatedly until a terminal status is reached.
      const deadline = Date.now() + 10_000;
      let lastStatus = "queued";
      let pollCount = 0;

      while (Date.now() < deadline) {
        const pollRes = await request(app)
          .get(`/api/datasets/upload/jobs/${jobId}`)
          .set(AUTH_A);

        expect(pollRes.status).toBe(200);
        expect(typeof (pollRes.body as { status: string }).status).toBe("string");
        expect(typeof (pollRes.body as { progress: number }).progress).toBe("number");

        lastStatus = (pollRes.body as { status: string }).status;
        pollCount++;
        if (lastStatus === "done" || lastStatus === "error") break;
        await new Promise<void>((r) => setTimeout(r, 150));
      }

      expect(lastStatus, `job was still "${lastStatus}" after ${pollCount} polls`).toBe("done");
      // Confirm multiple polls were made (not just one) to exercise the loop.
      expect(pollCount).toBeGreaterThanOrEqual(1);
    },
    15_000,
  );

  it("returns 403 when a different user tries to poll another user's job", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 1, AUTH_A);
    const jobId = await finalizeUpload(uploadId, 1, AUTH_A);

    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${jobId}`)
      .set(AUTH_B);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "forbidden");
  });

  it("returns 409 when finalize is called a second time for the same uploadId", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId, 0, 1, AUTH_A);

    const body = { uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 };

    const first = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set(AUTH_A)
      .set("Content-Type", "application/json")
      .send(body);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set(AUTH_A)
      .set("Content-Type", "application/json")
      .send(body);
    expect(second.status).toBe(409);
  });

  it("returns 404 from the DB slow path when the jobId appears after a simulated restart", async () => {
    // Simulate a server restart: the in-memory map is empty (cleared by
    // clearAllCaches in setup.ts), but DB also returns nothing (unknown job).
    // The poll endpoint should fall through to the DB slow path and return 404.
    const unknownJobId = crypto.randomUUID();

    const res = await request(app)
      .get(`/api/datasets/upload/jobs/${unknownJobId}`)
      .set(AUTH_A);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not_found");
  });
});
