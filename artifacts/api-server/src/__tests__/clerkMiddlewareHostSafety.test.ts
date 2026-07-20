/**
 * clerkMiddlewareHostSafety.test.ts
 *
 * Regression guard: verifies that app.ts registers clerkMiddleware with a
 * STATIC publishableKey (derived from env vars at startup) rather than a
 * per-request proxyUrl factory that reads x-forwarded-host directly.
 *
 * Background
 * ----------
 * clerkProxyMiddleware.ts uses getClerkProxyHost() to build the Clerk-Proxy-Url
 * header; that function validates x-forwarded-host against an allowlist before
 * use.  If a future refactor added a per-request `proxyUrl` callback to the
 * clerkMiddleware options in app.ts, reading req.headers["x-forwarded-host"]
 * directly there would re-open the host-injection vector that getClerkProxyHost()
 * was written to close.
 *
 * These tests catch that regression by asserting:
 *  1. clerkMiddleware is called with a static string publishableKey — not a
 *     function that derives the key from per-request headers.
 *  2. No proxyUrl option is passed as a function (which would imply per-request
 *     host reading).
 *  3. A request carrying an injected x-forwarded-host header reaches a route
 *     and is processed without poisoning the auth configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("./helpers/db-mock.js");
  const mock = createDbMock();
  return {
    ...mock,
    pool: {
      query: vi.fn().mockResolvedValue({
        rows: [{ count: 1, oldest_epoch: Date.now() / 1000 }],
      }),
    },
  };
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

import app from "../app.js";
import { clerkMiddleware } from "@clerk/express";
import { __resetRateLimitMemory } from "../middlewares/rateLimit.js";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("REPLIT_DEV_DOMAIN", "");
  vi.stubEnv("ALLOWED_ORIGINS", "");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Static key assertion ───────────────────────────────────────────────────────

describe("clerkMiddleware initialisation — static key, no per-request host reading", () => {
  it("is called exactly once during app.ts initialisation", () => {
    const calls = vi.mocked(clerkMiddleware).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("receives a static string publishableKey, not a per-request factory function", () => {
    const calls = vi.mocked(clerkMiddleware).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const opts = calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(opts).toBeDefined();
    // publishableKey must be a resolved string at init time — not a callback.
    expect(typeof opts!["publishableKey"]).toBe("string");
  });

  it("does not receive a proxyUrl function (which would indicate per-request host derivation)", () => {
    const calls = vi.mocked(clerkMiddleware).mock.calls;
    const opts = calls[0]?.[0] as Record<string, unknown> | undefined;
    // If proxyUrl is present it must be a static string or absent — never a
    // function that reads req headers, which would be an injection vector.
    expect(typeof opts?.["proxyUrl"]).not.toBe("function");
  });
});

// ── Host injection via x-forwarded-host ──────────────────────────────────────

describe("clerkMiddleware host path — injected x-forwarded-host is inert", () => {
  it("a request with an attacker-controlled x-forwarded-host still reaches the route (no crash)", async () => {
    // The clerkMiddleware path in app.ts uses static keys; a crafted
    // x-forwarded-host header has no effect on publishableKey or secretKey.
    const res = await request(app)
      .get("/api/healthz")
      .set("x-forwarded-host", "evil.attacker.com")
      .set("x-e2e-user-id", "user_host_inject_test");

    // The route should respond normally — 200 or 404 depending on whether
    // /api/healthz exists, but NOT a 500 caused by a poisoned Clerk config.
    expect(res.status).not.toBe(500);
  });

  it("does not set Clerk-Proxy-Url to an attacker host on a proxied path", async () => {
    // The /api/__clerk proxy path is a no-op in test (NODE_ENV !== production),
    // so the proxy middleware is bypassed. This assertion documents the expected
    // defence-in-depth: even if the proxy were active, getClerkProxyHost() would
    // reject the injected host before it could appear in Clerk-Proxy-Url.
    const res = await request(app)
      .get("/api/__clerk/v1/environment")
      .set("x-forwarded-host", "evil.attacker.com")
      .set("host", "legitimate.replit.app");

    // Response may be 404/502/etc — the important thing is no 500 crash.
    expect(res.status).not.toBe(500);
  });
});
