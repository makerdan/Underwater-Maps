/**
 * upload.test.ts
 *
 * Regression tests for five upload security / reliability fixes that are
 * already in production, plus unit tests for the two new server-owned
 * uploadId gate paths introduced in this task.
 *
 * Tests:
 *  1. Session-hijack guard — a second user submitting chunk 0 with an existing
 *     uploadId receives 409.
 *  2. Same-user chunk-0 retry is accepted (not blocked).
 *  3. Finalize idempotency — a second finalize for the same uploadId while its
 *     job is queued/processing receives 409.
 *  4. Direct-upload DB hard failure returns 500 (not 200 with a saveError).
 *  5. Stale sessions past ABANDONED_UPLOAD_THRESHOLD_MS are evicted by
 *     sweepStaleUploadSessions(); subsequent chunk submissions then receive 404.
 *  6. Chunk status enumerates received chunks from disk, not from a
 *     client-supplied list.
 *  7. Server-owned uploadId gate (chunk-submit) — chunk-0 without a prior
 *     POST /start receives 403.
 *  8. Server-owned uploadId gate (finalize) — a finalize request whose session
 *     was not issued by the server receives 403.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks — must appear before any import of the modules they replace.
// ---------------------------------------------------------------------------

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  return { ...actual };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  // The default mock returns [] from .returning(), which the direct-upload
  // path treats as a hard DB failure and responds with 500.  Chunk session
  // creation uses .onConflictDoNothing() (separate mock, resolves []).
  return createDbMock();
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
  lte: vi.fn(() => "lte-condition"),
  gte: vi.fn(() => "gte-condition"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  inArray: vi.fn(() => "in-condition"),
  isNull: vi.fn(() => "isNull-condition"),
  isNotNull: vi.fn(() => "isNotNull-condition"),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
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
// Imports after mocks
// ---------------------------------------------------------------------------

import app from "../app.js";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";
import {
  sweepStaleUploadSessions,
  setUploadSessionForTest,
  getUploadSessionForTest,
  setUploadJobForTest,
  ABANDONED_UPLOAD_THRESHOLD_MS,
} from "../routes/datasets.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_BASE_DIR = path.join(os.tmpdir(), "bathyscan-chunks");

const USER_A = "user_upload_security_a";
const USER_B = "user_upload_security_b";
const AUTH_A = { "x-mock-clerk-user-id": USER_A };
const AUTH_B = { "x-mock-clerk-user-id": USER_B };

// Valid XYZ CSV — 12 points spanning a small bbox.
// The route requires >= 10 points; TEXT_EXTENSIONS bypass the sparse-survey guard.
const SMALL_CSV = Buffer.from(
  "lon,lat,depth\n" +
    "-72.5,41.0,100\n" +
    "-72.4,41.0,150\n" +
    "-72.3,41.0,200\n" +
    "-72.2,41.0,180\n" +
    "-72.5,41.1,120\n" +
    "-72.4,41.1,160\n" +
    "-72.3,41.1,210\n" +
    "-72.2,41.1,190\n" +
    "-72.5,41.2,130\n" +
    "-72.4,41.2,170\n" +
    "-72.3,41.2,220\n" +
    "-72.2,41.2,200\n",
  "utf8",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call POST /api/datasets/upload/start and return the server-issued uploadId. */
async function startUpload(
  authHeaders: Record<string, string> = AUTH_A,
): Promise<string> {
  const res = await request(app)
    .post("/api/datasets/upload/start")
    .set(authHeaders);
  expect(res.status, `startUpload failed: ${JSON.stringify(res.body)}`).toBe(200);
  return (res.body as { uploadId: string }).uploadId;
}

/** Send a single chunk to POST /api/datasets/upload/chunk. */
function sendChunk(
  uploadId: string,
  chunkIndex: number,
  totalChunks: number,
  authHeaders: Record<string, string> = AUTH_A,
  payload: Buffer = SMALL_CSV,
) {
  return request(app)
    .post("/api/datasets/upload/chunk")
    .set(authHeaders)
    .field("uploadId", uploadId)
    .field("chunkIndex", String(chunkIndex))
    .field("totalChunks", String(totalChunks))
    .attach("file", payload, { filename: "survey.xyz", contentType: "text/plain" });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetRateLimitMemory();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1–6: Regression tests for existing production fixes
// ═══════════════════════════════════════════════════════════════════════════════

describe("Upload security — existing production fixes", () => {
  it(
    "1. returns 409 when a second user sends chunk-0 with an already-claimed uploadId",
    async () => {
      const uploadId = await startUpload(AUTH_A);

      const first = await sendChunk(uploadId, 0, 2, AUTH_A);
      expect(first.status).toBe(200);

      // User B attempts to claim the same uploadId — must be rejected.
      const second = await sendChunk(uploadId, 0, 2, AUTH_B);
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ error: "upload_conflict" });
    },
  );

  it("2. accepts a same-user chunk-0 retry without blocking (idempotent)", async () => {
    const uploadId = await startUpload(AUTH_A);

    const first = await sendChunk(uploadId, 0, 1, AUTH_A);
    expect(first.status).toBe(200);

    // Same user retrying chunk-0 (e.g. after a transient network error).
    const retry = await sendChunk(uploadId, 0, 1, AUTH_A);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ received: 0 });
  });

  it(
    "3. returns 409 when finalize is called while its job is already queued/processing",
    async () => {
      const uploadId = await startUpload(AUTH_A);
      const chunkRes = await sendChunk(uploadId, 0, 1, AUTH_A);
      expect(chunkRes.status).toBe(200);

      // Simulate a first-finalize state: set activeJobId on the session and
      // register the job as queued so the in-memory idempotency guard fires.
      const session = getUploadSessionForTest(uploadId);
      expect(session).toBeDefined();
      const jobId = `idempotency-job-${uploadId.slice(0, 8)}`;
      setUploadJobForTest(jobId, { status: "queued", progress: 0, userId: USER_A });
      setUploadSessionForTest(uploadId, { ...session!, activeJobId: jobId });

      const res = await request(app)
        .post("/api/datasets/upload/chunk/finalize")
        .set(AUTH_A)
        .set("Content-Type", "application/json")
        .send({ uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "already_processing", jobId });
    },
  );

  it(
    "4. returns 500 (not a silent success) when the DB insert fails during a direct upload",
    async () => {
      // The default db mock returns [] from .returning(), which the handler
      // interprets as "no row inserted" and converts to a hard 500.
      const res = await request(app)
        .post("/api/datasets/upload")
        .set(AUTH_A)
        .field("resolution", "32")
        .attach("file", SMALL_CSV, {
          filename: "survey.csv",
          contentType: "text/csv",
        });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error", "save_failed");
    },
  );

  it(
    "5. returns 404 for chunk-1 after the session is evicted past the staleness cutoff",
    async () => {
      const uploadId = await startUpload(AUTH_A);
      const chunkRes = await sendChunk(uploadId, 0, 2, AUTH_A);
      expect(chunkRes.status).toBe(200);

      // Age the session past the abandonment threshold so the sweep evicts it.
      const session = getUploadSessionForTest(uploadId);
      expect(session).toBeDefined();
      setUploadSessionForTest(uploadId, {
        ...session!,
        lastActivityAt: Date.now() - ABANDONED_UPLOAD_THRESHOLD_MS - 60_000,
      });

      await sweepStaleUploadSessions();

      // Session is gone; subsequent chunk must return 404 (no DB row either).
      expect(getUploadSessionForTest(uploadId)).toBeUndefined();

      const chunk1 = await sendChunk(uploadId, 1, 2, AUTH_A);
      expect(chunk1.status).toBe(404);
      expect(chunk1.body).toHaveProperty("error", "session_not_found");
    },
  );

  it(
    "6. GET chunk/status enumerates received chunks from disk, not from client data",
    async () => {
      const uploadId = await startUpload(AUTH_A);
      const chunkRes = await sendChunk(uploadId, 0, 3, AUTH_A);
      expect(chunkRes.status).toBe(200);

      // Real disk read: chunk-0 exists, chunks 1 and 2 do not.
      const statusRes = await request(app)
        .get(`/api/datasets/upload/chunk/status/${uploadId}`)
        .set(AUTH_A);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body).toMatchObject({ uploadId });
      expect(statusRes.body.receivedChunks).toContain(0);
      expect(statusRes.body.receivedChunks).not.toContain(1);
      expect(statusRes.body.receivedChunks).not.toContain(2);

      // Spy: return an empty directory — the client cannot inject fake chunks.
      const readdirSpy = vi
        .spyOn(fs.promises, "readdir")
        .mockResolvedValueOnce(
          [] as unknown as ReturnType<typeof fs.promises.readdir> extends Promise<infer T>
            ? T
            : never,
        );

      const emptyRes = await request(app)
        .get(`/api/datasets/upload/chunk/status/${uploadId}`)
        .set(AUTH_A);

      readdirSpy.mockRestore();

      expect(emptyRes.status).toBe(200);
      // An empty directory → receivedChunks=[], not synthesised from session data.
      expect(emptyRes.body.receivedChunks).toEqual([]);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7–8: New server-owned uploadId gate
// ═══════════════════════════════════════════════════════════════════════════════

describe("Server-owned uploadId gate", () => {
  it(
    "7. returns 403 when chunk-0 is submitted with a client-supplied UUID (no prior POST /start)",
    async () => {
      const clientUUID = crypto.randomUUID();
      const res = await sendChunk(clientUUID, 0, 1, AUTH_A);
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error", "upload_not_started");
    },
  );

  it(
    "8. returns 403 when finalize is called for a session not issued by the server",
    async () => {
      const uploadId = crypto.randomUUID();
      // Plant a session WITHOUT serverIssued — simulates a client that injected
      // a session directly without going through POST /start.
      setUploadSessionForTest(uploadId, {
        userId: USER_A,
        lastActivityAt: Date.now(),
        // serverIssued intentionally absent → gate must reject
      });

      // Make the chunk-file access check pass so we reach the serverIssued gate.
      const accessSpy = vi
        .spyOn(fs.promises, "access")
        .mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/datasets/upload/chunk/finalize")
        .set(AUTH_A)
        .set("Content-Type", "application/json")
        .send({ uploadId, fileName: "survey.xyz", totalChunks: 1, resolution: 32 });

      accessSpy.mockRestore();

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty("error", "upload_not_started");
    },
  );
});
