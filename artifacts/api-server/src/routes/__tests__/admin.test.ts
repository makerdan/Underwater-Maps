/**
 * admin.test.ts — integration tests for the admin routes.
 *
 * Covers:
 *   GET /admin/bucket-monitor — auth-gated, admin-only bucket status
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/bucketMonitor.js", () => ({
  getBucketStatus: vi.fn().mockResolvedValue({
    pending: 0,
    processing: 0,
    done: 5,
    failed: 1,
    objects: [],
  }),
  getLifecycleApplyStatus: vi.fn().mockReturnValue({ appliedAt: null, error: null }),
  LIFECYCLE_TTLS: { processedDays: 30, failedDays: 14 },
}));

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
