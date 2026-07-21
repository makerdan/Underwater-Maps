/**
 * admin.test.ts — integration tests for the admin routes.
 *
 * Covers:
 *   GET /admin/bucket-monitor      — auth-gated, admin-only bucket status
 *   GET /admin/large-datasets-diff — auth-gated, admin-only drift detection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockGetLargeDatasetsDiff } = vi.hoisted(() => ({
  mockGetLargeDatasetsDiff: vi.fn().mockResolvedValue({
    changedCount: 0,
    unimportedCount: 0,
    entries: [],
  }),
}));

vi.mock("../../lib/bucketMonitor.js", async () => {
  const { createBucketMonitorMock } = await import(
    "../../__tests__/helpers/bucketMonitorMock.js"
  );
  const { vi } = await import("vitest");
  return createBucketMonitorMock({
  getBucketStatus: vi.fn().mockResolvedValue({
    counts: { pending: 0, processing: 0, done: 5, failed: 1 },
    pending: [],
    processing: [],
    done: [
      { key: "processed-datasets/user_1/a.laz", owner: "user_1", sizeBytes: 123, ageMs: 1000 },
    ],
    failed: [
      {
        key: "failed-datasets/user_1/b.laz",
        owner: "user_1",
        sizeBytes: 456,
        ageMs: 2000,
        error: "parse failed",
      },
    ],
  }),
  getLifecycleApplyStatus: vi.fn().mockReturnValue({ appliedAt: null, error: null }),
  LIFECYCLE_TTLS: { processedDays: 30, failedDays: 14 },
  getLargeDatasetsDiff: mockGetLargeDatasetsDiff,
  });
});

const { mockQueryRateLimitUsage } = vi.hoisted(() => ({
  mockQueryRateLimitUsage: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../middlewares/rateLimit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/rateLimit.js")>();
  return {
    ...actual,
    queryRateLimitUsage: mockQueryRateLimitUsage,
    stampBaselineRateLimitHeaders: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  },
}));

import adminRouter from "../admin.js";

const E2E_USER = "user_e2e_admin_test";

function makeApp() {
  const app = express();
  app.use(adminRouter);
  return app;
}

describe("GET /admin/bucket-monitor — authentication", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.unstubAllEnvs();
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp()).get("/admin/bucket-monitor");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user is not an admin", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "0");
    vi.stubEnv("ADMIN_USER_IDS", "other_user");
    const res = await request(makeApp())
      .get("/admin/bucket-monitor")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("returns 200 when BUCKET_MONITOR_ADMIN=1 is set", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
    const res = await request(makeApp())
      .get("/admin/bucket-monitor")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("lifecycle");
  });

  it("returns 200 when user is in ADMIN_USER_IDS", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "0");
    vi.stubEnv("ADMIN_USER_IDS", E2E_USER);
    const res = await request(makeApp())
      .get("/admin/bucket-monitor")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body.lifecycle).toMatchObject({
      processedDatasetsTtlDays: 30,
      failedDatasetsTtlDays: 14,
    });
  });
});

describe("GET /admin/large-datasets-diff — authentication", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    mockGetLargeDatasetsDiff.mockResolvedValue({
      changedCount: 0,
      unimportedCount: 0,
      entries: [],
    });
  });

  it("returns 401 when the request is unauthenticated", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    const res = await request(makeApp()).get("/admin/large-datasets-diff");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user is not an admin", async () => {
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "0");
    vi.stubEnv("ADMIN_USER_IDS", "other_user");
    const res = await request(makeApp())
      .get("/admin/large-datasets-diff")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("returns 200 with empty diff when all files match", async () => {
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
    const res = await request(makeApp())
      .get("/admin/large-datasets-diff")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      changedCount: 0,
      unimportedCount: 0,
      entries: [],
    });
  });

  it("returns changed and unimported entries when files have drifted", async () => {
    vi.stubEnv("BUCKET_MONITOR_ADMIN", "1");
    mockGetLargeDatasetsDiff.mockResolvedValue({
      changedCount: 1,
      unimportedCount: 1,
      entries: [
        {
          filename: "survey_2024.xyz",
          largeDatasetsMd5: "newHash==",
          recordedSourceMd5: "oldHash==",
          status: "changed",
        },
        {
          filename: "new_survey.xyz",
          largeDatasetsMd5: "abc123==",
          status: "unimported",
        },
      ],
    });
    const res = await request(makeApp())
      .get("/admin/large-datasets-diff")
      .set("x-e2e-user-id", E2E_USER);
    expect(res.status).toBe(200);
    expect(res.body.changedCount).toBe(1);
    expect(res.body.unimportedCount).toBe(1);
    expect(res.body.entries).toHaveLength(2);
    const changed = res.body.entries.find((e: { status: string }) => e.status === "changed");
    expect(changed).toMatchObject({
      filename: "survey_2024.xyz",
      status: "changed",
    });
    const unimported = res.body.entries.find((e: { status: string }) => e.status === "unimported");
    expect(unimported).toMatchObject({
      filename: "new_survey.xyz",
      status: "unimported",
    });
  });
});

describe("GET /admin/rate-limit/usage — query param validation", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("ADMIN_USER_IDS", E2E_USER);
    mockQueryRateLimitUsage.mockClear();
    mockQueryRateLimitUsage.mockResolvedValue([]);
  });

  function get(url: string) {
    return request(makeApp()).get(url).set("x-e2e-user-id", E2E_USER);
  }

  it("applies defaults when no params are given", async () => {
    const res = await get("/admin/rate-limit/usage");
    expect(res.status).toBe(200);
    expect(res.body.windowMs).toBe(60000);
    expect(mockQueryRateLimitUsage).toHaveBeenCalledWith(60000, 25);
  });

  it("accepts in-range windowMs and limit", async () => {
    const res = await get("/admin/rate-limit/usage?windowMs=120000&limit=50");
    expect(res.status).toBe(200);
    expect(mockQueryRateLimitUsage).toHaveBeenCalledWith(120000, 50);
  });

  it("rejects non-numeric windowMs with 400", async () => {
    const res = await get("/admin/rate-limit/usage?windowMs=soon");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_param");
    expect(mockQueryRateLimitUsage).not.toHaveBeenCalled();
  });

  it("rejects out-of-range windowMs with 400", async () => {
    const res = await get("/admin/rate-limit/usage?windowMs=999999999999");
    expect(res.status).toBe(400);
    expect(mockQueryRateLimitUsage).not.toHaveBeenCalled();
  });

  it("rejects out-of-range limit with 400", async () => {
    const res = await get("/admin/rate-limit/usage?limit=9999");
    expect(res.status).toBe(400);
    expect(mockQueryRateLimitUsage).not.toHaveBeenCalled();
  });

  it("rejects array-injected params with 400", async () => {
    const res = await get("/admin/rate-limit/usage?limit=10&limit=20");
    expect(res.status).toBe(400);
    expect(mockQueryRateLimitUsage).not.toHaveBeenCalled();
  });
});
