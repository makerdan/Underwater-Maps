/**
 * finalize-double-processing.test.ts
 *
 * Regression coverage for the double-finalize guard on
 * POST /api/datasets/upload/chunk/finalize.
 *
 * Scenarios:
 * 1. Two concurrent finalize requests for the same uploadId — exactly one
 *    runs the processing pipeline (one parse worker spawned); the other
 *    receives 409 already_processing.
 * 2. Sequential double finalize — second call gets 409 with the existing
 *    jobId while the first job is queued/processing.
 * 3. DB-backed guard is authoritative: even when the in-memory session has
 *    no finalizing/activeJobId state (simulating a server restart), a DB row
 *    already in "processing" causes finalize to return 409 instead of
 *    re-triggering processing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted control handles shared between vi.mock factories and test bodies.
// ---------------------------------------------------------------------------

const { FakeParseWorker, workerSpawns, dbControl } = vi.hoisted(() => {
  const { EventEmitter } = require("events") as typeof import("events");

  const FAKE_TERRAIN = {
    depths: new Array(32 * 32).fill(50),
    width: 32,
    height: 32,
    minDepth: 50,
    maxDepth: 50,
    bounds: { minLon: 140, maxLon: 141, minLat: 10, maxLat: 11 },
  };

  const workerSpawns = { count: 0 };

  class FakeParseWorker extends EventEmitter {
    constructor(_path: string, _options?: unknown) {
      super();
      workerSpawns.count++;
      setImmediate(() => {
        this.emit("message", {
          type: "result",
          terrain: FAKE_TERRAIN,
          overview: FAKE_TERRAIN,
        });
      });
    }
    terminate(): Promise<number> {
      return Promise.resolve(0);
    }
  }

  // Chainable DB mocks with per-test override hooks (plain closures — vi.fn
  // is not available inside vi.hoisted).
  const dbControl = {
    selectResult: [] as unknown[],
    updateReturningResult: [{ id: "winner" }] as unknown[],
  };

  const selectWhere = () => Promise.resolve(dbControl.selectResult);
  const selectFrom = () => ({ where: selectWhere });

  // db.update(...).set(...).where(...) is awaited directly in some code paths
  // and chained with .returning(...) in the finalize guard, so where() must
  // return a thenable that also exposes returning().
  const updateWhere = () => ({
    returning: () => Promise.resolve(dbControl.updateReturningResult),
    then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    catch: (reject: (e: unknown) => unknown) => Promise.resolve([]).catch(reject),
    finally: (fn: () => void) => Promise.resolve([]).finally(fn),
  });
  const updateSet = () => ({ where: updateWhere });

  return {
    FakeParseWorker,
    workerSpawns,
    dbControl: Object.assign(dbControl, { selectFrom, updateSet }),
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
      update: vi.fn().mockReturnValue({ set: dbControl.updateSet }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn(() => "in-condition"),
  lt: vi.fn(() => "lt-condition"),
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

import app from "../app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = "user_double_finalize";
const AUTH = { "x-mock-clerk-user-id": USER };

function resetDbDefaults(): void {
  dbControl.selectResult = [];
  dbControl.updateReturningResult = [{ id: "winner" }];
}

async function uploadChunk(uploadId: string): Promise<void> {
  const res = await request(app)
    .post("/api/datasets/upload/chunk")
    .set(AUTH)
    .field("uploadId", uploadId)
    .field("chunkIndex", "0")
    .field("totalChunks", "1")
    .attach("file", Buffer.from("lon,lat,depth\n140.0,10.0,100\n"), {
      filename: "survey.xyz",
      contentType: "text/plain",
    });
  expect(res.status, `chunk upload failed: ${JSON.stringify(res.body)}`).toBe(200);
}

function finalize(uploadId: string) {
  return request(app)
    .post("/api/datasets/upload/chunk/finalize")
    .set(AUTH)
    .set("Content-Type", "application/json")
    .send({ uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 });
}

/** Wait until the job reaches a terminal state so no work leaks across tests. */
async function waitForJobDone(jobId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/datasets/upload/jobs/${jobId}`).set(AUTH);
    const status = (res.body as { status?: string }).status;
    if (status === "done" || status === "error") return;
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /datasets/upload/chunk/finalize — double-finalize guard", () => {
  beforeEach(() => {
    resetDbDefaults();
    workerSpawns.count = 0;
  });

  it("runs processing exactly once when two finalize requests race", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId);

    const [first, second] = await Promise.all([finalize(uploadId), finalize(uploadId)]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    const loser = first.status === 200 ? second : first;
    expect(winner.body).toHaveProperty("jobId");
    expect(loser.body).toMatchObject({ error: "already_processing" });

    await waitForJobDone((winner.body as { jobId: string }).jobId);
    expect(workerSpawns.count).toBe(1);
  }, 15_000);

  it("returns 409 with the existing jobId on a sequential repeat finalize", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId);

    const first = await finalize(uploadId);
    expect(first.status).toBe(200);
    const jobId = (first.body as { jobId: string }).jobId;

    const second = await finalize(uploadId);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "already_processing", jobId });

    await waitForJobDone(jobId);
    expect(workerSpawns.count).toBe(1);
  }, 15_000);

  it("DB guard blocks finalize when the row is already processing, even without in-memory state (restart scenario)", async () => {
    const uploadId = crypto.randomUUID();
    await uploadChunk(uploadId);

    // Simulate the state after a server restart: the DB row for this upload
    // is already queued/processing (another instance / pre-restart finalize
    // won). The conditional status-transition UPDATE finds no eligible row,
    // and the follow-up SELECT reports "processing".
    dbControl.updateReturningResult = [];
    dbControl.selectResult = [{ status: "processing" }];

    const res = await finalize(uploadId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "already_processing" });
    expect(res.body).toHaveProperty("jobId");
    expect(workerSpawns.count).toBe(0);
  });
});
