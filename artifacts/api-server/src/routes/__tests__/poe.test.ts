import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// vi.hoisted lets us share the fake Poe client `create` mock with the
// vi.mock factory (which is itself hoisted above all imports).
const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }));

// Partially mock @workspace/poe — keep real cache / retry / hashing helpers
// but stub out getPoeClient so no network call is made.
vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>(
    "@workspace/poe",
  );
  return {
    ...actual,
    getPoeClient: vi.fn(() => ({ responses: { create: fakeCreate } })),
  };
});

// Mock the DB so usage logging is a no-op.
vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  },
  poeUsageLogTable: {},
}));

// Mock Clerk + proxy middlewares so the app boots without a live tenant.
// Auth in tests goes through the shared `requireAuth` middleware
// (`src/middlewares/requireAuth.ts`), which honors `x-e2e-user-id` when
// `E2E_AUTH_BYPASS=1` is set in the environment (see beforeEach below).
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
import { globalPoeCache } from "@workspace/poe";

const GRID_BASE64 = Buffer.from("fake-grid-bytes-for-testing").toString(
  "base64",
);

function buildOkResponse() {
  return {
    id: "resp_test_123",
    output_text: JSON.stringify({
      zones: Array(1024).fill("sandy_shelf"),
    }),
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

beforeEach(() => {
  // Turn on the env-gated e2e bypass so requests carrying `x-e2e-user-id`
  // authenticate as that user without contacting Clerk. The bypass is
  // hard-gated on this env var and is never honored in production.
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  globalPoeCache.clear();
  fakeCreate.mockReset();
  fakeCreate.mockResolvedValue(buildOkResponse());
});

describe("POST /api/poe/classify", () => {
  it("returns 400 when gridBase64 is missing", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-missing-grid")
      .send({ waterType: "saltwater" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "missing_field" });
    expect(fakeCreate).not.toHaveBeenCalled();
  });

  it("returns a 1024-element zones array on a valid request", async () => {
    const res = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-valid")
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-valid",
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.zones)).toBe(true);
    expect(res.body.zones).toHaveLength(1024);
    expect(res.body.fromCache).toBe(false);
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });

  it("returns fromCache=true on a repeated request with the same payload", async () => {
    const body = {
      gridBase64: GRID_BASE64,
      waterType: "saltwater" as const,
      datasetId: "ds-cache",
    };

    const first = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cache")
      .send(body);
    expect(first.status).toBe(200);
    expect(first.body.fromCache).toBe(false);

    const second = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", "user-cache")
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.fromCache).toBe(true);
    expect(second.body.zones).toHaveLength(1024);
    // The Poe client should only have been called once — second was cached.
    expect(fakeCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 429 once the per-user rate limit (30 req/min) is exceeded", async () => {
    const userId = "user-ratelimit";

    // Burn through the 30-request window. Vary datasetId so the cache
    // doesn't short-circuit each call before logUsage runs.
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .post("/api/poe/classify")
        .set("x-e2e-user-id", userId)
        .send({
          gridBase64: GRID_BASE64,
          waterType: "saltwater",
          datasetId: `ds-rl-${i}`,
        });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .post("/api/poe/classify")
      .set("x-e2e-user-id", userId)
      .send({
        gridBase64: GRID_BASE64,
        waterType: "saltwater",
        datasetId: "ds-rl-overflow",
      });

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: "rate_limit" });
  });
});
