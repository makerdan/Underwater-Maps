/**
 * multer-chunk-limit.test.ts
 *
 * Confirms that POST /api/datasets/upload/chunk enforces a 6 MB per-chunk
 * limit and returns HTTP 413 with the standard error shape when a larger
 * chunk is sent.
 *
 * The multerErrorHandler middleware is intentionally placed between the multer
 * disk-storage middleware and the asyncHandler route body so that
 * MulterError("LIMIT_FILE_SIZE") is caught and translated to a structured 413
 * instead of propagating to Express's default error handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
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

const E2E_USER = "user_chunk_limit_test";
const CHUNK_6MB_PLUS_ONE = Buffer.alloc(6 * 1024 * 1024 + 1, 0x41);

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload/chunk — 6 MB per-chunk limit", () => {
  it("returns 413 when a single chunk exceeds 6 MB", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", "test-upload-chunk-limit-01")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", CHUNK_6MB_PLUS_ONE, "oversized.csv");

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: "file_too_large" });
  });

  it("returns 401 when unauthenticated (no bypass header)", async () => {
    vi.unstubAllEnvs();
    const smallChunk = Buffer.alloc(1024, 0x41);
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .field("uploadId", "test-upload-chunk-limit-01")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", smallChunk, "small.csv");

    expect(res.status).toBe(401);
  });

  it("returns 200 when a valid chunk within the 6 MB limit is accepted", async () => {
    const validChunk = Buffer.alloc(1024, 0x41);
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", E2E_USER)
      .field("uploadId", "test-upload-chunk-ok-01234567")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", validChunk, "small.csv");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: 0 });
  });
});
