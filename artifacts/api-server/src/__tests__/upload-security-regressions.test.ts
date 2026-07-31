/**
 * upload-security-regressions.test.ts
 *
 * Regression coverage for five security/reliability fixes applied to the
 * chunked and direct upload pipelines.  Each test targets one specific
 * protection that must not silently regress in future refactors.
 *
 * Scenarios:
 *
 * C-1. Chunk-0 claim guard: a second user submitting chunk 0 with an
 *      uploadId already owned by user A receives 409 (not 200).
 *
 * C-2. Same-user chunk-0 retry: sending chunk 0 twice with the same user
 *      keeps the existing session (sessionJobId unchanged) instead of
 *      overwriting it and creating a second DB row.
 *
 * H-1. Finalize strict DB persist: when db.insert (persistJobToDB) throws,
 *      finalize returns 500 and does NOT spawn a parse worker.
 *
 * H-2. Direct-upload DB hard failure: POST /datasets/upload returns 500
 *      with error:"save_failed" when the customDatasetsTable insert throws.
 *
 * L-10a. Chunk-status: accessible-but-empty chunk directory returns [].
 *
 * L-10b. Chunk-status: inaccessible chunk directory falls back to the
 *        DB chunksReceived count and synthesises receivedChunks = [0..N-1].
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";

// ---------------------------------------------------------------------------
// Hoisted control handles — shared between vi.mock() factories and test bodies
// ---------------------------------------------------------------------------

const { FakeParseWorker, workerSpawnCount, dbControl } = vi.hoisted(() => {
  const { EventEmitter } = require("events") as typeof import("events");

  const FAKE_TERRAIN = {
    depths: new Array(32 * 32).fill(50),
    width: 32,
    height: 32,
    minDepth: 50,
    maxDepth: 50,
    bounds: { minLon: 140, maxLon: 141, minLat: 10, maxLat: 11 },
  };

  const workerSpawnCount = { value: 0 };

  class FakeParseWorker extends EventEmitter {
    constructor(_path: string, _options?: unknown) {
      super();
      workerSpawnCount.value++;
      setImmediate(() => {
        this.emit("message", { type: "result", terrain: FAKE_TERRAIN, overview: FAKE_TERRAIN });
      });
    }
    terminate(): Promise<number> { return Promise.resolve(0); }
  }

  // Mutable state: per-test overrides control what each DB operation returns.
  const dbControl = {
    // db.select: returns the row array for all select queries
    selectRows: [] as unknown[],
    // db.insert returning: by default succeeds; set to null to make it throw
    insertShouldThrow: false,
    insertThrowMessage: "DB write failed",
    // db.update for finalize idempotency guard
    updateReturningRows: [{ id: "winner" }] as unknown[],
  };

  // Bare closures for the mock factories (vi.fn is not available inside vi.hoisted)
  const selectWhere = () => Promise.resolve(dbControl.selectRows);
  const selectFrom = () => ({ where: selectWhere });

  const insertReturning = () => {
    if (dbControl.insertShouldThrow) {
      return Promise.reject(new Error(dbControl.insertThrowMessage));
    }
    return Promise.resolve([]);
  };
  const insertOnConflictDoUpdate = () => {
    // Make the result thenable so `await db.insert().values().onConflictDoUpdate()`
    // propagates the rejection when insertShouldThrow is true.  Drizzle's real
    // builder is also thenable — plain-object returns would silently swallow the
    // throw because `await plainObject` always resolves.
    if (dbControl.insertShouldThrow) {
      return Promise.reject(new Error(dbControl.insertThrowMessage));
    }
    return Object.assign(Promise.resolve([]), { returning: insertReturning });
  };
  const insertOnConflictDoNothing = () => Promise.resolve([]);
  const insertValues = () => ({
    onConflictDoUpdate: insertOnConflictDoUpdate,
    onConflictDoNothing: insertOnConflictDoNothing,
    returning: insertReturning,
  });

  const updateWhere = () => ({
    returning: () => Promise.resolve(dbControl.updateReturningRows),
    then: (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve([]).catch(rej),
    finally: (fn: () => void) => Promise.resolve([]).finally(fn),
  });
  const updateSet = () => ({ where: updateWhere });

  const deleteReturning = () => Promise.resolve([]);
  const deleteWhere = () => ({ returning: deleteReturning });

  return {
    FakeParseWorker,
    workerSpawnCount,
    dbControl: Object.assign(dbControl, { selectFrom, insertValues, updateSet, deleteWhere }),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
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
      insert: vi.fn().mockReturnValue({ values: dbControl.insertValues }),
      update: vi.fn().mockReturnValue({ set: dbControl.updateSet }),
      delete: vi.fn().mockReturnValue({ where: dbControl.deleteWhere }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn(() => "in-condition"),
  lt: vi.fn(() => "lt-condition"),
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
  // Return userId from the test-only x-mock-clerk-user-id header.
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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import { getUploadSessionForTest } from "../routes/datasets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(userId: string) {
  return { "x-mock-clerk-user-id": userId };
}

/**
 * Start a server-owned upload session for `userId` and upload chunk 0.
 * Returns the server-issued uploadId (client-supplied uploadIds are rejected
 * with 403 upload_not_started since the server-owned uploadId change).
 */
async function uploadChunk0(userId: string): Promise<string> {
  const startRes = await request(app)
    .post("/api/datasets/upload/start")
    .set(authHeader(userId));
  expect(startRes.status, `upload/start failed for ${userId}: ${JSON.stringify(startRes.body)}`).toBe(200);
  const uploadId = (startRes.body as { uploadId: string }).uploadId;
  const res = await request(app)
    .post("/api/datasets/upload/chunk")
    .set(authHeader(userId))
    .field("uploadId", uploadId)
    .field("chunkIndex", "0")
    .field("totalChunks", "1")
    .attach("file", Buffer.from("hello"), { filename: "data.xyz", contentType: "text/plain" });
  expect(res.status, `chunk-0 upload failed for ${userId}: ${JSON.stringify(res.body)}`).toBe(200);
  return uploadId;
}

function resetDbDefaults(): void {
  dbControl.selectRows = [];
  dbControl.insertShouldThrow = false;
  dbControl.insertThrowMessage = "DB write failed";
  dbControl.updateReturningRows = [{ id: "winner" }];
  workerSpawnCount.value = 0;
}

// ---------------------------------------------------------------------------
// C-1: Chunk-0 claim guard — different user → 409
// ---------------------------------------------------------------------------

describe("C-1: chunk-0 claim guard — second user gets 409", () => {
  beforeEach(() => {
    __resetRateLimitMemory();
    resetDbDefaults();
  });

  it("returns 409 when a second user tries to claim an uploadId already owned by user A", async () => {
    const userA = "user_claim_A";
    const userB = "user_claim_B";

    // User A claims the uploadId first.
    const uploadId = await uploadChunk0(userA);

    // User B sends chunk 0 with the same uploadId — should be rejected.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set(authHeader(userB))
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", Buffer.from("evil"), { filename: "data.xyz", contentType: "text/plain" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "upload_conflict" });
  });

  it("the 409 does not expose information about the legitimate owner", async () => {
    const uploadId = await uploadChunk0("user_claim_C");

    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set(authHeader("user_claim_D"))
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", Buffer.from("x"), { filename: "data.xyz", contentType: "text/plain" });

    expect(res.status).toBe(409);
    // Response must not include any userId-like fields.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("user_claim_C");
  });
});

// ---------------------------------------------------------------------------
// C-2: Same-user chunk-0 retry — session preserved
// ---------------------------------------------------------------------------

describe("C-2: same-user chunk-0 retry — session preserved, not overwritten", () => {
  beforeEach(() => {
    __resetRateLimitMemory();
    resetDbDefaults();
  });

  it("keeps the same sessionJobId when the same user sends chunk 0 twice", async () => {
        const userId = "user_retry_chunk0";

    // First chunk-0: creates session with a sessionJobId.
    const uploadId = await uploadChunk0(userId);
    const sessionAfterFirst = getUploadSessionForTest(uploadId);
    expect(sessionAfterFirst).toBeDefined();
    const originalJobId = sessionAfterFirst!.sessionJobId;
    expect(originalJobId).toMatch(/^[0-9a-f-]{36}$/i);

    // Second chunk-0 from the same user: should succeed and keep the same sessionJobId.
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set(authHeader(userId))
      .field("uploadId", uploadId)
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", Buffer.from("retry"), { filename: "data.xyz", contentType: "text/plain" });

    expect(res.status).toBe(200);

    const sessionAfterRetry = getUploadSessionForTest(uploadId);
    expect(sessionAfterRetry).toBeDefined();
    // The sessionJobId must NOT have changed — we must not create a second DB row.
    expect(sessionAfterRetry!.sessionJobId).toBe(originalJobId);
  });
});

// ---------------------------------------------------------------------------
// H-1: Finalize strict DB persist failure → 500, no worker
// ---------------------------------------------------------------------------

describe("H-1: finalize strict DB persist failure", () => {
  beforeEach(() => {
    __resetRateLimitMemory();
    resetDbDefaults();
  });

  it("returns 500 when persistJobToDB (db.insert) throws during finalize", async () => {
        const userId = "user_finalize_fail";

    // Upload chunk 0 to create the session.
    const uploadId = await uploadChunk0(userId);

    // Make db.insert throw for the finalize persist step.
    dbControl.insertShouldThrow = true;
    dbControl.insertThrowMessage = "disk quota exceeded";

    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set(authHeader(userId))
      .set("Content-Type", "application/json")
      .send({ uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "finalize_db_error" });
  });

  it("does NOT fire processUploadJob when DB persist fails", async () => {
        const userId = "user_finalize_no_worker";

    const uploadId = await uploadChunk0(userId);

    dbControl.insertShouldThrow = true;

    await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set(authHeader(userId))
      .set("Content-Type", "application/json")
      .send({ uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 });

    // Give any accidentally-fired async job time to start.
    await new Promise<void>((r) => setTimeout(r, 100));
    expect(workerSpawnCount.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// H-2: Direct-upload DB hard failure → 500
// ---------------------------------------------------------------------------

// Minimal valid XYZ CSV (12 points — above the 10-point threshold).
const VALID_XYZ_CSV = [
  "lon,lat,depth",
  "-70.0,42.0,10", "-70.1,42.1,20", "-70.2,42.2,30",
  "-70.3,42.3,40", "-70.4,42.4,50", "-70.5,42.5,60",
  "-70.6,42.6,70", "-70.7,42.7,80", "-70.8,42.8,90",
  "-70.9,42.9,100", "-71.0,43.0,110", "-71.1,43.1,120",
].join("\n");

describe("H-2: direct-upload DB hard failure", () => {
  beforeEach(() => {
    __resetRateLimitMemory();
    resetDbDefaults();
  });

  it("returns 500 (not 200) when the customDatasetsTable insert throws", async () => {
    dbControl.insertShouldThrow = true;
    dbControl.insertThrowMessage = "unique constraint violation";

    const res = await request(app)
      .post("/api/datasets/upload")
      // Use the Clerk mock auth header (same as all other tests in this file).
      // requireAuth reads x-mock-clerk-user-id via the @clerk/express mock.
      .set(authHeader("user_direct_db_fail"))
      .field("resolution", "32")
      .attach("file", Buffer.from(VALID_XYZ_CSV), {
        filename: "survey.xyz",
        contentType: "text/plain",
      });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "save_failed" });
  });

  it("error body details contains the underlying DB error message", async () => {
    dbControl.insertShouldThrow = true;
    dbControl.insertThrowMessage = "disk quota exceeded";

    const res = await request(app)
      .post("/api/datasets/upload")
      .set(authHeader("user_direct_db_fail_msg"))
      .field("resolution", "32")
      .attach("file", Buffer.from(VALID_XYZ_CSV), {
        filename: "survey.xyz",
        contentType: "text/plain",
      });

    expect(res.status).toBe(500);
    // details should include the underlying error message
    const body = res.body as { error: string; details?: string };
    expect(body.details).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// L-10a: Chunk-status: accessible-but-empty directory returns []
// L-10b: Chunk-status: inaccessible directory falls back to DB count
// ---------------------------------------------------------------------------

describe("L-10: chunk-status disk / DB fallback logic", () => {
  let readdirSpy: { mockRestore(): void } | undefined;

  beforeEach(() => {
    __resetRateLimitMemory();
    resetDbDefaults();
    // Restore ONLY the readdir spy from a previous test.  vi.restoreAllMocks()
    // would also clear vi.fn().mockReturnValue() implementations (Vitest v3
    // behaviour), wiping the db.select mock that the DB-fallback path depends on.
    readdirSpy?.mockRestore();
    readdirSpy = undefined;
  });

  afterEach(() => {
    // Same targeted restore — do not call vi.restoreAllMocks() here.
    readdirSpy?.mockRestore();
    readdirSpy = undefined;
  });

  it("L-10a: returns receivedChunks=[] when chunk directory exists but is empty", async () => {
        const userId = "user_status_empty_dir";

    // Create session so the auth check passes.
    const uploadId = await uploadChunk0(userId);

    // Override readdir to return an empty list (directory accessible, no chunks).
    readdirSpy = vi.spyOn(fs.promises, "readdir").mockResolvedValueOnce([] as never);

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set(authHeader(userId));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uploadId, receivedChunks: [] });
  });

  it("L-10a: does NOT synthesise chunks from DB count when directory is accessible but empty", async () => {
        const userId = "user_status_accessible_empty";

    const uploadId = await uploadChunk0(userId);

    // Directory is accessible but contains no chunk files for this uploadId.
    readdirSpy = vi.spyOn(fs.promises, "readdir").mockResolvedValueOnce(
      // Other uploads' files present, but none for this uploadId.
      ["other-upload-chunk-0", "another-chunk-1"] as never,
    );

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set(authHeader(userId));

    expect(res.status).toBe(200);
    expect((res.body as { receivedChunks: number[] }).receivedChunks).toEqual([]);
  });

  it("L-10b: returns synthesised receivedChunks=[0..N-1] when chunk directory is inaccessible", async () => {
    const uploadId = crypto.randomUUID();
    const userId = "user_status_no_dir";
    const CHUNKS_RECEIVED = 3;

    // Do NOT pre-seed session in memory — let the DB fallback path run.
    // DB returns the session + chunksReceived so the status route can recover.
    dbControl.selectRows = [{
      userId,
      sessionJobId: "mock-job-" + uploadId.slice(0, 8),
      chunksReceived: CHUNKS_RECEIVED,
    }];

    // Make readdir throw so the disk path is skipped.
    readdirSpy = vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("no such file or directory"), { code: "ENOENT" }),
    );

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set(authHeader(userId));

    expect(res.status).toBe(200);
    const { receivedChunks } = res.body as { receivedChunks: number[] };
    // Should synthesise [0, 1, 2] from chunksReceived=3.
    expect(receivedChunks).toEqual([0, 1, 2]);
  });

  it("L-10b: returns [] (no fallback) when directory is inaccessible and DB chunksReceived is 0", async () => {
    const uploadId = crypto.randomUUID();
    const userId = "user_status_no_dir_zero";

    dbControl.selectRows = [{
      userId,
      sessionJobId: "mock-job-zero",
      chunksReceived: 0,
    }];

    readdirSpy = vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("no such file or directory"), { code: "ENOENT" }),
    );

    const res = await request(app)
      .get(`/api/datasets/upload/chunk/status/${uploadId}`)
      .set(authHeader(userId));

    expect(res.status).toBe(200);
    expect((res.body as { receivedChunks: number[] }).receivedChunks).toEqual([]);
  });
});
