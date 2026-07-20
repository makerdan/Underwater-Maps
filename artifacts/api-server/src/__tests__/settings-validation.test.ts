/**
 * settings-validation.test.ts
 *
 * Regression tests for two related changes in PUT /api/settings:
 *
 *   1. intertidalMhwOverrideFt and intertidalMhhwOverrideFt are now validated
 *      by the server-side Zod schema (PutSettingsBody) instead of silently
 *      falling through to the extras path. Values outside [-500, 500] must be
 *      rejected with 400; null must be accepted.
 *
 *   2. Freshwater band-limit guard: when stored.waterType === "freshwater" and
 *      the incoming request switches waterType to "saltwater", the server must
 *      NOT overwrite intertidalMhwOverrideFt / intertidalMhhwOverrideFt with
 *      the client-supplied values (which default to null for saltwater). The
 *      stored freshwater values must survive the preset switch intact.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";

// ─── Shared mock state ────────────────────────────────────────────────────────

const valMocks = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([]);
  const fromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const onConflictDoUpdateMock = vi.fn().mockResolvedValue([]);
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
  return { selectWhereMock, fromMock, onConflictDoUpdateMock, valuesMock };
});

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock({
    db: {
      select: vi.fn().mockReturnValue({ from: valMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: valMocks.valuesMock }),
    },
  });
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn((req: { headers: Record<string, string> }) => ({
    userId: req.headers["x-mock-clerk-user-id"] || null,
  })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const AUTH = { "x-mock-clerk-user-id": "user_validation_test" };

afterEach(() => {
  vi.clearAllMocks();
  valMocks.selectWhereMock.mockResolvedValue([]);
});

// ─── 1. intertidalMhwOverrideFt / intertidalMhhwOverrideFt Zod validation ────

describe("PUT /api/settings — intertidalMhwOverrideFt Zod validation", () => {
  it("accepts a finite value within the valid range", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: 3.5 });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBe(3.5);
  });

  it("accepts null (clears the override)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: null });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBeNull();
  });

  it("accepts the boundary value -500", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: -500 });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBe(-500);
  });

  it("accepts the boundary value 500", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: 500 });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBe(500);
  });

  it("rejects a value above 500 with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: 500.1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a value below -500 with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: -500.1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a non-numeric string with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhwOverrideFt: "five" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

describe("PUT /api/settings — intertidalMhhwOverrideFt Zod validation", () => {
  it("accepts a finite value within the valid range", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhhwOverrideFt: -12.75 });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhhwOverrideFt).toBe(-12.75);
  });

  it("accepts null (clears the override)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhhwOverrideFt: null });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhhwOverrideFt).toBeNull();
  });

  it("rejects a value above 500 with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhhwOverrideFt: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("rejects a value below -500 with 400", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ intertidalMhhwOverrideFt: -9999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

// ─── 2. Freshwater band-limit guard ──────────────────────────────────────────

describe("PUT /api/settings — freshwater band-limit guard", () => {
  /** Seed the mock DB with an existing freshwater settings row. */
  function seedFreshwaterRow(overrides: Record<string, unknown> = {}) {
    valMocks.selectWhereMock.mockResolvedValue([
      {
        userId: AUTH["x-mock-clerk-user-id"],
        settings: {
          waterType: "freshwater",
          intertidalMhwOverrideFt: 4.2,
          intertidalMhhwOverrideFt: 5.1,
          ...overrides,
        },
      },
    ]);
  }

  it("preserves freshwater MHW override when switching waterType to saltwater", async () => {
    seedFreshwaterRow();

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "saltwater",
        intertidalMhwOverrideFt: null,
      });

    expect(res.status).toBe(200);
    // The stored freshwater value (4.2) must survive — the client null must not win.
    expect(res.body.intertidalMhwOverrideFt).toBe(4.2);
  });

  it("preserves freshwater MHHW override when switching waterType to saltwater", async () => {
    seedFreshwaterRow();

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "saltwater",
        intertidalMhhwOverrideFt: null,
      });

    expect(res.status).toBe(200);
    // The stored freshwater value (5.1) must survive.
    expect(res.body.intertidalMhhwOverrideFt).toBe(5.1);
  });

  it("preserves both override fields when switching waterType to saltwater with both in body", async () => {
    seedFreshwaterRow();

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "saltwater",
        intertidalMhwOverrideFt: null,
        intertidalMhhwOverrideFt: null,
      });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBe(4.2);
    expect(res.body.intertidalMhhwOverrideFt).toBe(5.1);
  });

  it("does NOT apply guard when switching waterType from saltwater to freshwater", async () => {
    valMocks.selectWhereMock.mockResolvedValue([
      {
        userId: AUTH["x-mock-clerk-user-id"],
        settings: {
          waterType: "saltwater",
          intertidalMhwOverrideFt: null,
          intertidalMhhwOverrideFt: null,
        },
      },
    ]);

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "freshwater",
        intertidalMhwOverrideFt: 3.0,
        intertidalMhhwOverrideFt: 4.0,
      });

    expect(res.status).toBe(200);
    // No guard — client-supplied values must be stored.
    expect(res.body.intertidalMhwOverrideFt).toBe(3.0);
    expect(res.body.intertidalMhhwOverrideFt).toBe(4.0);
  });

  it("does NOT apply guard when waterType stays freshwater (direct override update)", async () => {
    seedFreshwaterRow();

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "freshwater",
        intertidalMhwOverrideFt: 7.5,
        intertidalMhhwOverrideFt: 8.0,
      });

    expect(res.status).toBe(200);
    // User is explicitly updating freshwater overrides — must be accepted.
    expect(res.body.intertidalMhwOverrideFt).toBe(7.5);
    expect(res.body.intertidalMhhwOverrideFt).toBe(8.0);
  });

  it("does NOT apply guard when waterType stays saltwater", async () => {
    valMocks.selectWhereMock.mockResolvedValue([
      {
        userId: AUTH["x-mock-clerk-user-id"],
        settings: {
          waterType: "saltwater",
          intertidalMhwOverrideFt: null,
        },
      },
    ]);

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "saltwater",
        intertidalMhwOverrideFt: 2.0,
      });

    expect(res.status).toBe(200);
    // No guard — stored was already saltwater; client 2.0 must win.
    expect(res.body.intertidalMhwOverrideFt).toBe(2.0);
  });

  it("does NOT apply guard when override fields are absent from the request body", async () => {
    seedFreshwaterRow();

    // The client switches waterType but does NOT include the override keys —
    // guard must not fire (no keys to strip), and the stored values survive
    // naturally via the standard merge priority (stored wins over DEFAULT_SETTINGS
    // for absent sent keys).
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ waterType: "saltwater" });

    expect(res.status).toBe(200);
    // Stored values survive because they were never in sentValidated.
    expect(res.body.intertidalMhwOverrideFt).toBe(4.2);
    expect(res.body.intertidalMhhwOverrideFt).toBe(5.1);
  });

  it("does NOT apply guard when there is no prior stored row (first-ever PUT)", async () => {
    // No stored row — existing is undefined, stored.waterType is undefined.
    // Guard must not fire because stored.waterType !== "freshwater".
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({
        waterType: "saltwater",
        intertidalMhwOverrideFt: 1.5,
        intertidalMhhwOverrideFt: 2.5,
      });

    expect(res.status).toBe(200);
    expect(res.body.intertidalMhwOverrideFt).toBe(1.5);
    expect(res.body.intertidalMhhwOverrideFt).toBe(2.5);
  });
});
