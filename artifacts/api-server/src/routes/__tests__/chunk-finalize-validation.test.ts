/**
 * chunk-finalize-validation.test.ts — HTTP validation tests for POST /api/datasets/upload/chunk/finalize
 *
 * Covers:
 *  - Missing uploadId → 400
 *  - Array-injection on uploadId → 400
 *  - out-of-range totalChunks (0, 4097) → 400
 *  - Invalid resolution (below min, above max, non-integer) → 400
 *  - Valid minimal body (all required fields, no resolution) → not 400 (session-not-found or 404)
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

let currentUserId: string | null = "user-finalize-test";

const VALID_UPLOAD_ID = "abcd1234efgh5678";

beforeEach(() => {
  currentUserId = "user-finalize-test";
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload/chunk/finalize — body field validation", () => {
  it("returns 400 when uploadId is missing", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({ fileName: "scan.laz", totalChunks: 3 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when uploadId is injected as an array", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({
        uploadId: ["abcd1234efgh5678", "zzzz9999xxxx8888"],
        fileName: "scan.laz",
        totalChunks: 3,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when totalChunks is 0 (below minimum)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({ uploadId: VALID_UPLOAD_ID, fileName: "scan.laz", totalChunks: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when totalChunks is 4097 (above maximum)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({ uploadId: VALID_UPLOAD_ID, fileName: "scan.laz", totalChunks: 4097 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when resolution is below minimum (31)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({
        uploadId: VALID_UPLOAD_ID,
        fileName: "scan.laz",
        totalChunks: 3,
        resolution: 31,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when resolution is above maximum (513)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({
        uploadId: VALID_UPLOAD_ID,
        fileName: "scan.laz",
        totalChunks: 3,
        resolution: 513,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when resolution is a non-integer (1.5)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({
        uploadId: VALID_UPLOAD_ID,
        fileName: "scan.laz",
        totalChunks: 3,
        resolution: 1.5,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("passes schema validation and reaches business logic (session not found) for a valid body", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/chunk/finalize")
      .set("x-e2e-user-id", "user-finalize-test")
      .send({
        uploadId: VALID_UPLOAD_ID,
        fileName: "scan.laz",
        totalChunks: 3,
      });

    expect(res.status).not.toBe(400);
    expect(res.body).not.toMatchObject({ error: "invalid_request" });
  });
});
