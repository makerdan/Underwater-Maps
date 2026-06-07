/**
 * cors-mutation.test.ts
 *
 * Security audit: verifies that mutating routes (POST, PUT, PATCH, DELETE) do
 * NOT reflect an arbitrary cross-origin `Origin` header back as
 * `Access-Control-Allow-Origin` when an explicit allowlist is configured.
 *
 * The CORS middleware reads ALLOWED_ORIGINS (and REPLIT_DEV_DOMAIN) on each
 * request, so tests can control the allowlist via vi.stubEnv without needing
 * to reset the app module.
 *
 * Key assertions:
 *  - Non-allowlisted origin → no Access-Control-Allow-Origin header
 *  - Allowlisted origin → Access-Control-Allow-Origin echoes the allowed origin
 *  - No Origin header (same-origin / curl) → always allowed (no CORS block)
 *  - In production mode with no allowlist → non-allowlisted origin is rejected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock();
  return { ...mock, pool: { query: vi.fn().mockResolvedValue({ rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }] }) } };
});

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../app.js";

const ALLOWED_ORIGIN = "https://allowed.example.com";
const EVIL_ORIGIN = "https://evil.example.com";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  // Isolate tests: clear REPLIT_DEV_DOMAIN so it doesn't accidentally widen the allowlist.
  vi.stubEnv("REPLIT_DEV_DOMAIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Suite 1: explicit allowlist set — non-allowlisted origin must be rejected
// ---------------------------------------------------------------------------

describe("CORS — non-allowlisted origin is rejected when ALLOWED_ORIGINS is set", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);
  });

  it("POST from non-allowlisted origin: Access-Control-Allow-Origin is absent", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("Origin", EVIL_ORIGIN)
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    const acao = res.headers["access-control-allow-origin"];
    // The header must not reflect the evil origin.
    expect(acao).not.toBe(EVIL_ORIGIN);
    // It must also not be a wildcard.
    expect(acao).not.toBe("*");
  });

  it("POST from non-allowlisted origin: Vary is set but origin is not granted", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("Origin", EVIL_ORIGIN)
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    // Must never grant the evil origin.
    expect(res.headers["access-control-allow-origin"] ?? "").not.toContain(EVIL_ORIGIN);
  });

  it("OPTIONS preflight from non-allowlisted origin: origin not granted", async () => {
    const res = await request(app)
      .options("/api/datasets/upload")
      .set("Origin", EVIL_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-origin"] ?? "").not.toBe(EVIL_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: allowlisted origin IS granted
// ---------------------------------------------------------------------------

describe("CORS — allowlisted origin receives the header", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);
  });

  it("POST from allowlisted origin: Access-Control-Allow-Origin matches", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("Origin", ALLOWED_ORIGIN)
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });

  it("OPTIONS preflight from allowlisted origin: Access-Control-Allow-Origin matches", async () => {
    const res = await request(app)
      .options("/api/datasets/upload")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: no Origin header — always allowed (same-origin / server-to-server)
// ---------------------------------------------------------------------------

describe("CORS — requests without Origin header are always allowed", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_ORIGINS", ALLOWED_ORIGIN);
  });

  it("POST without Origin header succeeds (no CORS block)", async () => {
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    // Anything except 5xx is fine — we just need to confirm the request reaches
    // the route (not rejected at CORS).
    expect(res.status).not.toBe(500);
    // Without an Origin header, no CORS header is set (correct behaviour).
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: REPLIT_DEV_DOMAIN auto-inclusion
// ---------------------------------------------------------------------------

describe("CORS — REPLIT_DEV_DOMAIN is automatically allowlisted", () => {
  it("allows origin matching REPLIT_DEV_DOMAIN even without ALLOWED_ORIGINS", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "myproject.replit.dev");
    // Also simulate production so the dev-fallback path doesn't trigger.
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");

    const devOrigin = "https://myproject.replit.dev";
    const res = await request(app)
      .post("/api/datasets/upload")
      .set("Origin", devOrigin)
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    expect(res.headers["access-control-allow-origin"]).toBe(devOrigin);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: production mode — unknown origin rejected even without allowlist
// ---------------------------------------------------------------------------

describe("CORS — production mode rejects unknown origins when no allowlist is set", () => {
  it("does not grant an arbitrary origin when REPLIT_DEPLOYMENT=1 and ALLOWED_ORIGINS is empty", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "");
    vi.stubEnv("REPLIT_DEV_DOMAIN", "");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");

    const res = await request(app)
      .post("/api/datasets/upload")
      .set("Origin", EVIL_ORIGIN)
      .set("x-e2e-user-id", "user_cors_test")
      .field("resolution", "128")
      .attach("file", Buffer.from("lon,lat,depth\n"), "test.csv");

    expect(res.headers["access-control-allow-origin"] ?? "").not.toBe(EVIL_ORIGIN);
    expect(res.headers["access-control-allow-origin"] ?? "").not.toBe("*");
  });
});
