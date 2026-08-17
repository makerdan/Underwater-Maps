/**
 * missing-route-rate-limits.test.ts
 *
 * Regression guard: verifies that dataMutationRateLimit is applied to the six
 * routes that previously lacked it (audit finding, 2026-08):
 *
 *   catalog-saves.ts
 *     - DELETE  /api/datasets/my-saves/:id
 *     - PATCH   /api/datasets/my-saves/:id/rename
 *     - PATCH   /api/datasets/my-saves/:id/move
 *
 *   user-datasets.ts
 *     - PATCH   /api/user/datasets/:id/move
 *     - PATCH   /api/user/datasets/:id/rename
 *
 *   catches.ts
 *     - POST    /api/catch-photos/upload-url
 *
 * Strategy: pre-fill the in-memory rate-limit bucket to the hard ceiling with
 * __prefillRateLimitMemory so the next request arrives over-quota.  The 429 is
 * returned by the middleware before the handler runs, so no real DB responses
 * are needed for these cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that load the app.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    },
  });
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] ?? null,
  })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

// ObjectStorageService is only needed for the catch-photos route; mock it so
// it does not attempt real GCS calls in unit tests.
vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: vi.fn().mockImplementation(() => ({
    getObjectEntityUploadURL: vi.fn().mockResolvedValue("https://storage.example.com/upload?token=x"),
    normalizeObjectEntityPath: vi.fn().mockReturnValue("objects/abc123"),
  })),
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

// ObjectAcl is imported by catches.ts even though it is not hit by the rate-
// limited path; mock it to avoid real GCS calls.
vi.mock("../lib/objectAcl.js", () => ({
  getObjectAclPolicy: vi.fn().mockResolvedValue(null),
  setObjectAclPolicy: vi.fn().mockResolvedValue(undefined),
}));

import app from "../app.js";
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../middlewares/rateLimit.js";
import {
  DATA_MUTATION_ROUTE,
  DATA_MUTATION_WINDOW_MS,
  DATA_MUTATION_MAX,
} from "../middlewares/dataMutationRateLimit.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const USER_ID = "user_rate_limit_regression_test";
const AUTH = { "x-mock-clerk-user-id": USER_ID };
const SAVE_ID = "11111111-1111-1111-1111-111111111111";
const DATASET_ID = "22222222-2222-2222-2222-222222222222";

/** Pre-fill the per-user data-mutation bucket to the hard ceiling. */
function exhaustBucket(): void {
  __prefillRateLimitMemory(
    `u:${DATA_MUTATION_ROUTE}:${USER_ID}`,
    DATA_MUTATION_MAX,
    DATA_MUTATION_WINDOW_MS,
  );
}

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// catalog-saves.ts — DELETE /api/datasets/my-saves/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/datasets/my-saves/:id — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .delete(`/api/datasets/my-saves/${SAVE_ID}`)
      .set(AUTH);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("does not rate-limit an unauthenticated request (401 before limiter)", async () => {
    exhaustBucket();
    const res = await request(app).delete(`/api/datasets/my-saves/${SAVE_ID}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// catalog-saves.ts — PATCH /api/datasets/my-saves/:id/rename
// ---------------------------------------------------------------------------

describe("PATCH /api/datasets/my-saves/:id/rename — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/rename`)
      .set(AUTH)
      .send({ displayLabel: "New Name" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});

// ---------------------------------------------------------------------------
// catalog-saves.ts — PATCH /api/datasets/my-saves/:id/move
// ---------------------------------------------------------------------------

describe("PATCH /api/datasets/my-saves/:id/move — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .patch(`/api/datasets/my-saves/${SAVE_ID}/move`)
      .set(AUTH)
      .send({ folderId: null });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});

// ---------------------------------------------------------------------------
// user-datasets.ts — PATCH /api/user/datasets/:id/move
// ---------------------------------------------------------------------------

describe("PATCH /api/user/datasets/:id/move — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .patch(`/api/user/datasets/${DATASET_ID}/move`)
      .set(AUTH)
      .send({ folderId: null });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});

// ---------------------------------------------------------------------------
// user-datasets.ts — PATCH /api/user/datasets/:id/rename
// ---------------------------------------------------------------------------

describe("PATCH /api/user/datasets/:id/rename — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .patch(`/api/user/datasets/${DATASET_ID}/rename`)
      .set(AUTH)
      .send({ name: "New Name" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });
});

// ---------------------------------------------------------------------------
// catches.ts — POST /api/catch-photos/upload-url
// ---------------------------------------------------------------------------

describe("POST /api/catch-photos/upload-url — rate limit", () => {
  it("returns 429 when the data-mutation bucket is exhausted", async () => {
    exhaustBucket();
    const res = await request(app)
      .post("/api/catch-photos/upload-url")
      .set(AUTH);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "rate_limit" });
  });

  it("does not rate-limit an unauthenticated request (401 before limiter)", async () => {
    exhaustBucket();
    const res = await request(app).post("/api/catch-photos/upload-url");
    expect(res.status).toBe(401);
  });
});
