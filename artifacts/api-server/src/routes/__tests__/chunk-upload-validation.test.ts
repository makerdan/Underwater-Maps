/**
 * chunk-upload-validation.test.ts — HTTP validation tests for POST /api/datasets/upload/chunk
 *
 * Covers:
 *  - Array-injection on uploadId (duplicate multipart fields) → 400
 *  - Array-injection on chunkIndex (duplicate multipart fields) → 400
 *  - Negative chunkIndex → 400
 *  - chunkIndex greater than or equal to totalChunks → 400
 *  - Missing uploadId → 400
 *  - Non-integer string for chunkIndex → 400
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        onConflictDoNothing: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {},
  datasetCatalogTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  uploadJobsTable: {},
  disabledPresetsTable: {},
  pool: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: currentUserId })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../../app.js";

let currentUserId: string | null = "user-chunk-test";

const VALID_UPLOAD_ID = "abcd1234efgh5678";
const CHUNK_DATA = Buffer.from("fake-chunk-data");

beforeEach(() => {
  currentUserId = "user-chunk-test";
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload/chunk — body field validation", () => {
  it("returns 400 when uploadId is injected as an array (duplicate fields)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", "aaaabbbbcccc1111")
      .field("uploadId", "ddddeeeeffffgggg")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is injected as an array (duplicate fields)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "0")
      .field("chunkIndex", "1")
      .field("totalChunks", "2")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is negative", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "-1")
      .field("totalChunks", "3")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is greater than or equal to totalChunks", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "5")
      .field("totalChunks", "3")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when uploadId is missing", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is a non-integer string", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "abc")
      .field("totalChunks", "3")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is a float string", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "1.5")
      .field("totalChunks", "3")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when chunkIndex is an empty string", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "")
      .field("totalChunks", "3")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when totalChunks is injected as an array (duplicate fields)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk")
      .set("x-e2e-user-id", "user-chunk-test")
      .field("uploadId", VALID_UPLOAD_ID)
      .field("chunkIndex", "0")
      .field("totalChunks", "1")
      .field("totalChunks", "2")
      .attach("file", CHUNK_DATA, "test.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });
});
