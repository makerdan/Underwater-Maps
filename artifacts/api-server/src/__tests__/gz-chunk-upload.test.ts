/**
 * gz-chunk-upload.test.ts
 *
 * Regression: before the fix in parseWorker.ts, uploading a .gz file via the
 * chunked path (POST /api/datasets/upload/chunk → /chunk/finalize) would fail:
 *
 *   Error: Unsupported file extension ".gz". Supported formats: .tif, .tiff, ...
 *
 * Root cause: parseWorker.ts called parseUploadedFile(raw, fileName) where
 * fileName still included ".gz" (e.g. "survey.tif.gz"). datasets.ts correctly
 * decompressed the file to a temp path before spawning the worker, but the
 * worker was routing on the original .gz extension instead of the inner one.
 *
 * Fix: parseWorker.ts now passes baseFileName (e.g. "survey.tif") to both
 * parseXyzCsv() and parseUploadedFile() so the parsers see the real format.
 *
 * Test strategy
 * -------------
 * worker_threads.Worker is replaced by FakeParseWorker — a lightweight
 * EventEmitter that emits a synthetic "result" message on the next tick.
 * This lets the test run without the compiled dist/lib/parseWorker.mjs binary
 * while still exercising every other step of processUploadJob:
 *   streamChunksToFile → streamGunzipToFile → runParseWorker → DB insert → job "done"
 *
 * The test sends a real gzip-compressed XYZ buffer as the chunk payload.
 * streamGunzipToFile runs with real zlib so the decompression path is live.
 */

import { describe, it, expect, vi } from "vitest";
import * as zlib from "zlib";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock: worker_threads.Worker
//
// vi.hoisted() runs before vi.mock() hoisting, so its return value is
// available inside the factory closure. FakeParseWorker cannot reference
// module-level variables directly because vi.mock factories are hoisted
// above all import/variable declarations.
// ---------------------------------------------------------------------------

const { FakeParseWorker } = vi.hoisted(() => {
  const { EventEmitter } = require("events") as typeof import("events");

  const FAKE_TERRAIN = {
    depths: new Array(32 * 32).fill(100),
    width: 32,
    height: 32,
    minDepth: 100,
    maxDepth: 100,
    bounds: { minLon: 142, maxLon: 143, minLat: 11, maxLat: 12 },
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

  return { FakeParseWorker };
});

vi.mock("worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("worker_threads")>();
  return { ...actual, Worker: FakeParseWorker };
});

// ---------------------------------------------------------------------------
// Remaining mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  // The chunked upload path calls both:
  //   db.insert(uploadJobsTable).values(...).onConflictDoUpdate(...)   [persistJobToDB]
  //   db.insert(customDatasetsTable).values(...).returning(...)         [final save]
  // Both share the same insert mock; values() must expose both methods.
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const returningMock = vi.fn().mockResolvedValue([{ id: "gz-chunk-dataset-id" }]);
  const valuesMock = vi.fn().mockReturnValue({
    returning: returningMock,
    onConflictDoUpdate: onConflictDoUpdateMock,
    onConflictDoNothing: vi.fn().mockResolvedValue([]),
  });
  return createDbMock({
    db: {
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
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
  getAuth: vi.fn((req: { headers: Record<string, string> }) => {
    const header = req.headers["x-mock-clerk-user-id"];
    return { userId: header ?? null };
  }),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTHED_HEADER = { "x-mock-clerk-user-id": "user_gz_chunk_test" };

function makeGzXyz(pointCount = 12): Buffer {
  const lines = ["lon,lat,depth"];
  for (let i = 0; i < pointCount; i++) {
    const lon = (142.0 + i * 0.01).toFixed(4);
    const lat = (11.0 + i * 0.01).toFixed(4);
    const depth = 1000 + i * 50;
    lines.push(`${lon},${lat},${depth}`);
  }
  return zlib.gzipSync(Buffer.from(lines.join("\n"), "utf8"));
}

// ---------------------------------------------------------------------------
// Regression test
// ---------------------------------------------------------------------------

describe("chunked .gz upload — regression: parseWorker must use baseFileName not fileName", () => {
  it(
    "completes with job status 'done' when a .gz-wrapped XYZ file is uploaded via the chunked path",
    async () => {
      const gzBuf = makeGzXyz();
      const uploadId = crypto.randomUUID();

      // Step 1: upload the entire gz buffer as chunk 0 of 1.
      const chunkRes = await request(app)
        .post("/api/datasets/upload/chunk")
        .set(AUTHED_HEADER)
        .field("uploadId", uploadId)
        .field("chunkIndex", "0")
        .field("totalChunks", "1")
        .attach("file", gzBuf, {
          filename: "survey.xyz.gz",
          contentType: "application/gzip",
        });

      expect(chunkRes.status).toBe(200);
      expect(chunkRes.body).toMatchObject({ received: 0 });

      // Step 2: finalize — queues processUploadJob in the background.
      const finalizeRes = await request(app)
        .post("/api/datasets/upload/chunk/finalize")
        .set(AUTHED_HEADER)
        .set("Content-Type", "application/json")
        .send({ uploadId, fileName: "survey.xyz.gz", totalChunks: 1, resolution: 32 });

      expect(finalizeRes.status).toBe(200);
      const { jobId } = finalizeRes.body as { jobId: string };
      expect(typeof jobId).toBe("string");

      // Step 3: poll until done or error (FakeParseWorker resolves on next tick
      // so in practice this takes only one or two polls).
      const deadline = Date.now() + 10_000;
      let lastStatus = "queued";
      let lastError = "";

      while (Date.now() < deadline) {
        const pollRes = await request(app)
          .get(`/api/datasets/upload/jobs/${jobId}`)
          .set(AUTHED_HEADER);

        expect(pollRes.status).toBe(200);
        const body = pollRes.body as { status: string; error?: string };
        lastStatus = body.status;
        lastError = body.error ?? "";
        if (lastStatus === "done" || lastStatus === "error") break;
        await new Promise((r) => setTimeout(r, 200));
      }

      // Before the fix this ended as "error" with:
      //   'Unsupported file extension ".gz". Supported formats: .tif, .tiff, ...'
      expect(lastStatus, `job failed: ${lastError}`).toBe("done");
      expect(lastError).toBe("");
    },
    15_000,
  );
});
