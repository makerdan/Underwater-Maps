/**
 * markers.test.ts — unit tests for /api/markers
 *
 * Covers:
 *  - 400 for missing datasetId on GET /markers
 *  - 401 for unauthenticated callers
 *  - DB failure on GET /markers returns 500 (not a hanging request), confirming
 *    asyncHandler correctly forwards the rejected promise to Express error
 *    middleware instead of leaving the request open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const state: { throwOnSelect: boolean } = { throwOnSelect: false };

vi.mock("@workspace/db", () => {
  const markersTable = { __tableName: "markers" as const };

  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () => {
          if (state.throwOnSelect) {
            return Promise.reject(new Error("DB connection lost"));
          }
          return Promise.resolve([]);
        },
      }),
    }),
  });

  return {
    db: { select },
    markersTable,
  };
});

vi.mock("@workspace/api-zod", () => ({
  GetMarkersQueryParams: {
    safeParse: (q: Record<string, unknown>) =>
      q["datasetId"]
        ? { success: true, data: { datasetId: q["datasetId"] } }
        : { success: false },
  },
  PostMarkersBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
  DeleteMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.throwOnSelect = false;
});

describe("GET /api/markers", () => {
  it("returns 401 when unauthenticated (no E2E bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app).get("/api/markers?datasetId=abc");
    expect(res.status).toBe(401);
  });

  it("returns 400 when datasetId query param is missing", async () => {
    const res = await request(app)
      .get("/api/markers")
      .set("x-e2e-user-id", "user-markers-400");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 500 (not a timeout) when the database throws", async () => {
    state.throwOnSelect = true;
    const res = await request(app)
      .get("/api/markers?datasetId=test-dataset")
      .set("x-e2e-user-id", "user-markers-db-fail");
    expect(res.status).toBe(500);
  });

  it("returns 200 with an array when the DB succeeds", async () => {
    const res = await request(app)
      .get("/api/markers?datasetId=test-dataset")
      .set("x-e2e-user-id", "user-markers-ok");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/markers — safeParse rejection (400) negative tests
//
// The PostMarkersBody mock always returns { success: false } so the route
// must reply 400 with { error: "invalid_request" } for any body. These tests
// document the expected 400 contract for each class of invalid input:
//   • missing required field (no body at all)
//   • wrong type (lon supplied as a string)
//   • extra-invalid: empty object (all required fields absent)
// ---------------------------------------------------------------------------

describe("POST /api/markers — safeParse rejection (400)", () => {
  it("returns 400 with error: invalid_request when the body is completely absent", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .set("content-type", "application/json")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when required field 'label' is missing from the body", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .send({ datasetId: "ds-1", lon: -136.0, lat: 58.5, depth: 50 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when 'lon' is supplied as a string (wrong type)", async () => {
    const res = await request(app)
      .post("/api/markers")
      .set("x-e2e-user-id", "user-markers-post-400")
      .send({ datasetId: "ds-1", lon: "not-a-number", lat: 58.5, depth: 50, label: "Test" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 401 when POSTing without auth (no bypass header)", async () => {
    vi.unstubAllEnvs();
    const res = await request(app)
      .post("/api/markers")
      .send({ datasetId: "ds-1", lon: -136.0, lat: 58.5, depth: 50, label: "Test" });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/markers/:id — safeParse rejection (400) negative tests
//
// PatchMarkersIdParams mock always returns { success: false }, so the route
// replies 400 for any :id before even inspecting the body.
// ---------------------------------------------------------------------------

describe("PATCH /api/markers/:id — safeParse rejection (400)", () => {
  it("returns 400 with error: invalid_request for any marker id (params validation)", async () => {
    const res = await request(app)
      .patch("/api/markers/not-a-uuid")
      .set("x-e2e-user-id", "user-markers-patch-400")
      .send({ label: "Updated" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 with error: invalid_request for a well-formed UUID id (params mock rejects all)", async () => {
    const res = await request(app)
      .patch("/api/markers/00000000-0000-0000-0000-000000000001")
      .set("x-e2e-user-id", "user-markers-patch-400")
      .send({ label: "Updated" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });
});
