/**
 * Regression tests for POST /datasets/upload — resolution / gridResolution
 * Zod validation.
 *
 * Covers:
 *  1. Both fields missing → 400 invalid_param
 *  2. `resolution` is a non-numeric string → 400 invalid_param
 *  3. Only `gridResolution` provided (legacy-client path) → 200 accepted
 *  4. Both fields provided → `resolution` wins (terrain.resolution matches)
 *  5. Zero value → 400 invalid_param (below min 32)
 *  6. Negative value → 400 invalid_param (below min 32)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("../../__tests__/helpers/db-mock.js");
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

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

const E2E_USER = "user_e2e_resolution_test";

// A minimal CSV with > 10 valid rows — used for success-path tests that reach
// the gridPoints call.
const VALID_CSV = [
  "lon,lat,depth",
  "-122.0,37.0,10",
  "-122.1,37.1,15",
  "-122.2,37.2,20",
  "-122.3,37.3,25",
  "-122.4,37.4,30",
  "-122.5,37.5,35",
  "-122.6,37.6,40",
  "-122.7,37.7,45",
  "-122.8,37.8,50",
  "-122.9,37.9,55",
  "-123.0,38.0,60",
].join("\n");

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload — resolution/gridResolution Zod validation", () => {
  it("returns 400 when both resolution and gridResolution are absent", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
    expect(res.body.details).toMatch(/resolution.*required/i);
  });

  it("returns 400 when resolution is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is zero (below minimum 32)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "0")
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is negative", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "-64")
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("accepts the request when only gridResolution is provided (legacy-client path)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("gridResolution", "64")
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    // The terrain grid should be built at the requested gridResolution.
    expect(res.body.terrain.resolution).toBe(64);
  });

  it("uses resolution (not gridResolution) when both are provided", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", E2E_USER)
      .field("resolution", "64")
      .field("gridResolution", "128")
      .attach("file", Buffer.from(VALID_CSV), "survey.csv");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("terrain");
    // resolution (64) must win over gridResolution (128).
    expect(res.body.terrain.resolution).toBe(64);
  });
});
