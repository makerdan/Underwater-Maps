/**
 * validation-response-parse.test.ts
 *
 * Verifies that response-parse failures in GET /settings and GET /datasets
 * are caught and returned as a structured 500 instead of crashing the process
 * or leaking an unhandled stack trace.
 *
 * GET /settings wraps GetSettingsResponse.parse(merged) in try/catch → 500.
 * GET /datasets wraps GetDatasetsResponse.parse(list)  in try/catch → 500.
 *
 * We exercise each branch by:
 *  - Settings: mocking the DB to return a row whose stored settings contain
 *    a field value that violates the Zod schema (textureQuality: "broken").
 *  - Datasets: replacing GetDatasetsResponse.parse with a mock that throws,
 *    simulating a schema regression against the static preset list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/api-zod", async () => {
  const actual =
    await vi.importActual<typeof import("@workspace/api-zod")>(
      "@workspace/api-zod",
    );
  return {
    ...actual,
    GetDatasetsResponse: {
      parse: vi
        .fn()
        .mockImplementation(() => {
          throw new Error("Mock schema validation failure for GetDatasetsResponse");
        }),
    },
  };
});

const validationMocks = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([
    { settings: { textureQuality: "broken-value-not-in-enum" } },
  ]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  return { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: validationMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: validationMocks.valuesMock }),
    },
  });
  return { ...mock, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn(() => "inarray-condition"),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTH = { "x-mock-clerk-user-id": "user_parse_error_test" };

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "");
});

describe("GET /api/settings — response parse failure → 500", () => {
  it("returns 500 with error:internal when stored settings violate the response schema", async () => {
    const res = await request(app)
      .get("/api/settings")
      .set(AUTH);

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error", "internal");
    expect(res.body).toHaveProperty("details");
    expect(typeof res.body.details).toBe("string");
  });

  it("returns 401 when unauthenticated (sanity check)", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/datasets — response parse failure → 500", () => {
  it("returns 500 with error:internal when GetDatasetsResponse.parse throws", async () => {
    const res = await request(app).get("/api/datasets");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error", "internal");
    expect(res.body).toHaveProperty("details");
    expect(typeof res.body.details).toBe("string");
  });
});
