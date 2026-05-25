/**
 * datasets.test.ts (routes) — integration tests for the dataset upload
 * numeric-param validation added in task #307. A malformed `resolution`
 * (or `gridResolution`) must surface as a clean 400 instead of falling
 * through `parseInt` → `NaN` and producing a 5xx from the downstream grid
 * call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
}));

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

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
});

describe("POST /api/datasets/upload — numeric-param validation", () => {
  it("returns 400 with invalid_param when resolution is malformed", async () => {
    const csv = "lon,lat,depth\n-122.0,37.0,10\n-122.1,37.1,15\n";
    const res = await request(app)
      .post("/api/datasets/upload")
      .field("resolution", "not-a-number")
      .attach("file", Buffer.from(csv), "small.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is out of range (too small)", async () => {
    const csv = "lon,lat,depth\n-122.0,37.0,10\n-122.1,37.1,15\n";
    const res = await request(app)
      .post("/api/datasets/upload")
      .field("resolution", "8")
      .attach("file", Buffer.from(csv), "small.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when resolution is out of range (too large)", async () => {
    const csv = "lon,lat,depth\n-122.0,37.0,10\n-122.1,37.1,15\n";
    const res = await request(app)
      .post("/api/datasets/upload")
      .field("resolution", "9999")
      .attach("file", Buffer.from(csv), "small.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("returns 400 when gridResolution alias is malformed", async () => {
    // Older clients send `gridResolution` instead of `resolution`. Both must
    // surface a clean 400 (not a 5xx) when the value isn't a valid int.
    const csv = "lon,lat,depth\n-122.0,37.0,10\n-122.1,37.1,15\n";
    const res = await request(app)
      .post("/api/datasets/upload")
      .field("gridResolution", "NaN")
      .attach("file", Buffer.from(csv), "small.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });
});

describe("GET /api/datasets/:id/zones — hash format compatibility", () => {
  it("rejects a hash that is neither 8-char nor 64-char hex", async () => {
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: "not-hex", w: "saltwater" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });

  it("accepts a 64-char sha256 hex hash (new client format)", async () => {
    const sha = "a".repeat(64);
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: sha, w: "saltwater" });
    // 404 (no cache entry) is the expected outcome here — what matters is
    // that the 64-char hash format passed the validator (no 400).
    expect(res.status).not.toBe(400);
  });

  it("rejects a request missing the waterType query param", async () => {
    const res = await request(app)
      .get("/api/datasets/glba_main/zones")
      .query({ h: "deadbeef" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_param" });
  });
});
