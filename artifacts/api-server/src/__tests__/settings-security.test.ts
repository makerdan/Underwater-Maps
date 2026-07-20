/**
 * settings-security.test.ts
 *
 * Security hardening regression tests for PUT /api/settings.
 *
 * Asserts three properties that must never silently regress:
 *   1. No user-controlled `.received` value appears in 400 response bodies.
 *   2. No user-controlled `.received` value appears in stderr log output.
 *   3. The server returns 400 when the total merged settings payload would
 *      exceed 256 KB, and does NOT proceed to upsert.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  return createDbMock();
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

const AUTH = { "x-mock-clerk-user-id": "user_security_test" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-scan a JSON-serialized value for any object key named "received". */
function containsReceivedKey(value: unknown): boolean {
  return JSON.stringify(value).includes('"received"');
}

// ---------------------------------------------------------------------------
// 1. No ".received" in 400 response body
// ---------------------------------------------------------------------------

describe("PUT /api/settings — Zod 400 response must not expose .received", () => {
  it("omits .received when units is an invalid enum value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "lightyears" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_request");
    expect(
      containsReceivedKey(res.body),
      `Response body must not contain a "received" key but got: ${JSON.stringify(res.body)}`,
    ).toBe(false);
  });

  it("omits .received when multiple fields are invalid", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "leagues", depthUnit: "fathoms_wrong", fogDensity: "not-a-number" });

    expect(res.status).toBe(400);
    expect(containsReceivedKey(res.body)).toBe(false);
  });

  it("includes .path and .code in each sanitized issue (no .received)", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "lightyears" });

    expect(res.status).toBe(400);
    const issues = res.body.issues as Array<Record<string, unknown>>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue).not.toHaveProperty("received");
      expect(issue).toHaveProperty("code");
    }
  });

  it("sanitized details string contains the error code but not the invalid value", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "lightyears" });

    expect(res.status).toBe(400);
    const details = res.body.details as string;
    expect(typeof details).toBe("string");
    expect(details).not.toContain("lightyears");
    expect(details).toContain("invalid_enum_value");
  });
});

// ---------------------------------------------------------------------------
// 2. No ".received" in stderr log output
// ---------------------------------------------------------------------------

describe("PUT /api/settings — Zod 400 stderr log must not expose .received", () => {
  let stderrChunks: string[] = [];
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrChunks = [];
    stderrSpy = (vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
      },
    ) as unknown) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("does not write .received or the invalid value to stderr when units is invalid", async () => {
    await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "attoparsecs" });

    const logged = stderrChunks.join("");
    expect(logged).not.toContain('"received"');
    expect(logged).not.toContain("attoparsecs");
  });

  it("does not write .received or invalid values to stderr when multiple fields are invalid", async () => {
    await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "leagues", textureQuality: "ultra_evil" });

    const logged = stderrChunks.join("");
    expect(logged).not.toContain('"received"');
    expect(logged).not.toContain("leagues");
    expect(logged).not.toContain("ultra_evil");
  });
});

// ---------------------------------------------------------------------------
// 3. Total merged payload cap (256 KB)
//
// The route merges stored DB settings with the incoming request, then checks
// the total via Buffer.byteLength(JSON.stringify(merged)).  Extras from the
// request body are capped at MAX_EXTRAS_BYTES (16 KB) so they alone cannot
// exceed the 256 KB total limit.  The only realistic way to hit the cap in
// tests is to inject a large row via the db.select mock so that "stored"
// settings are already near the limit before the request fields are merged in.
//
// We use mockReturnValueOnce on db.select to return a large stored row for the
// tests that verify the cap, and leave the default mock (empty array) in place
// for the happy-path test that verifies normal requests are still accepted.
// ---------------------------------------------------------------------------

/** 260 KB of stored settings data — large enough to exceed the 256 KB cap once
 *  merged with DEFAULT_SETTINGS and the small incoming { units: "metric" }. */
const LARGE_STORED_SETTINGS = { bigData: "x".repeat(260 * 1024) };

function mockLargeStoredRow(db: { select: ReturnType<typeof vi.fn> }) {
  vi.mocked(db.select).mockReturnValueOnce(
    {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { userId: AUTH["x-mock-clerk-user-id"], settings: LARGE_STORED_SETTINGS },
        ]),
      }),
    } as unknown as ReturnType<ReturnType<typeof vi.fn>["mockReturnValue"]>,
  );
}

describe("PUT /api/settings — total merged payload cap", () => {
  it("returns 400 when the stored+incoming merged payload would exceed 256 KB", async () => {
    const { db } = await import("@workspace/db");
    mockLargeStoredRow(db as unknown as Parameters<typeof mockLargeStoredRow>[0]);

    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "metric" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "invalid_request");
    expect(res.body.details as string).toMatch(/size cap/i);
  });

  it("does not proceed to upsert when the total merged payload cap is exceeded", async () => {
    const { db } = await import("@workspace/db");
    mockLargeStoredRow(db as unknown as Parameters<typeof mockLargeStoredRow>[0]);
    vi.mocked(db.insert).mockClear();

    await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "metric" });

    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("accepts a request when the merged payload is well within 256 KB", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set(AUTH)
      .send({ units: "metric" });

    expect(res.status).toBe(200);
  });
});
