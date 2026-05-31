/**
 * gcs-upload-route.test.ts
 *
 * Route-level tests for:
 *   POST /api/datasets/upload/request-gcs-url — presigned URL generation
 *   GET  /api/admin/bucket-monitor            — admin summary endpoint
 *
 * Both endpoints are exercised via supertest against the real Express app.
 * External I/O (GCS, DB) is replaced by module-level vi.mock stubs so the
 * tests run without network access or a real bucket.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Stub the entire bucketMonitor module ──────────────────────────────────────
// This prevents the GCS Storage client from being initialised and lets
// individual tests override signDatasetUploadUrl / getBucketStatus behaviour.

vi.mock("../lib/bucketMonitor.js", () => ({
  signDatasetUploadUrl: vi.fn(),
  getJobByObjectKey: vi.fn(),
  getBucketStatus: vi.fn(),
  startBucketMonitor: vi.fn(),
  gcsClient: {},
}));

// ── Minimal DB stub (datasets route imports db for custom-dataset queries) ──

vi.mock("@workspace/db", () => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const valuesMock = vi.fn().mockResolvedValue([]);
  return {
    db: {
      select: vi.fn().mockReturnValue({ from: fromMock }),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    },
    customDatasetsTable: {},
    userSettingsTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
}));

// ── Clerk / proxy mocks ───────────────────────────────────────────────────────

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

// ── Import app after all mocks are in place ───────────────────────────────────

import app from "../app.js";
import { signDatasetUploadUrl, getBucketStatus } from "../lib/bucketMonitor.js";

const AUTHED = { "x-mock-clerk-user-id": "user_test_gcs" };

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/datasets/upload/request-gcs-url
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/datasets/upload/request-gcs-url", () => {
  beforeEach(() => {
    vi.mocked(signDatasetUploadUrl).mockResolvedValue({
      uploadUrl: "https://storage.googleapis.com/test-bucket/pending-datasets/user_test_gcs/uuid-001/survey.csv?sig=fake",
      objectKey: "pending-datasets/user_test_gcs/uuid-001/survey.csv",
    });
  });

  it("returns 401 when no auth session is present", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .send({ fileName: "survey.csv" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 400 when fileName is missing", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 400 when fileName is an empty string", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_param");
  });

  it("returns 415 for an unsupported file extension", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "survey.exe" });

    expect(res.status).toBe(415);
    expect(res.body).toHaveProperty("error", "unsupported_file_type");
  });

  it("returns 415 for a file with no extension", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "no-extension" });

    expect(res.status).toBe(415);
    expect(res.body).toHaveProperty("error", "unsupported_file_type");
  });

  it("returns 200 with uploadUrl and objectKey for a valid .csv file", async () => {
    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "survey.csv" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("uploadUrl");
    expect(typeof res.body.uploadUrl).toBe("string");
    expect(res.body.uploadUrl.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty("objectKey");
    expect(res.body.objectKey).toMatch(/^pending-datasets\//);
    expect(vi.mocked(signDatasetUploadUrl)).toHaveBeenCalledWith(
      "user_test_gcs",
      "survey.csv",
    );
  });

  it("returns 200 with uploadUrl and objectKey for a valid .gz file", async () => {
    vi.mocked(signDatasetUploadUrl).mockResolvedValueOnce({
      uploadUrl: "https://storage.googleapis.com/test-bucket/pending-datasets/user_test_gcs/uuid-002/survey.xyz.gz?sig=fake",
      objectKey: "pending-datasets/user_test_gcs/uuid-002/survey.xyz.gz",
    });

    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "survey.xyz.gz" });

    expect(res.status).toBe(200);
    expect(res.body.objectKey).toMatch(/\.gz$/);
  });

  it("propagates a 500 when signDatasetUploadUrl throws", async () => {
    vi.mocked(signDatasetUploadUrl).mockRejectedValueOnce(
      new Error("sidecar unavailable"),
    );

    const res = await request(app)
      .post("/api/datasets/upload/request-gcs-url")
      .set(AUTHED)
      .send({ fileName: "survey.csv" });

    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/bucket-monitor
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_SUMMARY = {
  counts: { pending: 1, processing: 0, done: 3, failed: 1 },
  pending: [{ key: "pending-datasets/user_abc/uuid-x/file.csv", owner: "user_abc", sizeBytes: 1024, ageMs: 5000 }],
  processing: [],
  done: [
    { key: "processed-datasets/user_abc/uuid-y/file.csv", owner: "user_abc", sizeBytes: 1024, ageMs: 10000 },
    { key: "processed-datasets/user_abc/uuid-z/file.csv", owner: "user_abc", sizeBytes: 2048, ageMs: 20000 },
    { key: "processed-datasets/user_def/uuid-w/file.csv", owner: "user_def", sizeBytes: 512, ageMs: 30000 },
  ],
  failed: [{ key: "failed-datasets/user_abc/uuid-bad/broken.csv", owner: "user_abc", sizeBytes: 256, ageMs: 15000, error: "parse error" }],
};

describe("GET /api/admin/bucket-monitor", () => {
  beforeEach(() => {
    vi.mocked(getBucketStatus).mockResolvedValue(MOCK_SUMMARY);
    // Clear admin env vars before each test so tests are isolated
    delete process.env["BUCKET_MONITOR_ADMIN"];
    delete process.env["ADMIN_USER_IDS"];
  });

  it("returns 401 when no auth session is present", async () => {
    const res = await request(app).get("/api/admin/bucket-monitor");

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Unauthorized");
  });

  it("returns 403 for an authenticated non-admin user", async () => {
    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "forbidden");
  });

  it("returns 200 with summary shape when BUCKET_MONITOR_ADMIN=1 (any user is admin)", async () => {
    process.env["BUCKET_MONITOR_ADMIN"] = "1";

    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(res.body.counts).toMatchObject({
      pending: expect.any(Number),
      processing: expect.any(Number),
      done: expect.any(Number),
      failed: expect.any(Number),
    });
    expect(Array.isArray(res.body.pending)).toBe(true);
    expect(Array.isArray(res.body.processing)).toBe(true);
    expect(Array.isArray(res.body.done)).toBe(true);
    expect(Array.isArray(res.body.failed)).toBe(true);
  });

  it("returns correct counts from the summary", async () => {
    process.env["BUCKET_MONITOR_ADMIN"] = "1";

    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ pending: 1, processing: 0, done: 3, failed: 1 });
    expect(res.body.pending).toHaveLength(1);
    expect(res.body.done).toHaveLength(3);
    expect(res.body.failed[0]).toHaveProperty("error", "parse error");
  });

  it("returns 200 when the authenticated user is listed in ADMIN_USER_IDS", async () => {
    process.env["ADMIN_USER_IDS"] = "user_test_gcs,user_other";

    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
  });

  it("returns 403 when the authenticated user is not in ADMIN_USER_IDS", async () => {
    process.env["ADMIN_USER_IDS"] = "user_someone_else";

    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(403);
  });

  it("propagates a 500 when getBucketStatus throws", async () => {
    process.env["BUCKET_MONITOR_ADMIN"] = "1";
    vi.mocked(getBucketStatus).mockRejectedValueOnce(new Error("GCS unavailable"));

    const res = await request(app)
      .get("/api/admin/bucket-monitor")
      .set(AUTHED);

    expect(res.status).toBe(500);
  });
});
