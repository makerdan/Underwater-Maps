/**
 * requireAuth-bypass-guard.test.ts
 *
 * Verifies the startup safety guard added to requireAuth.ts: the module must
 * throw immediately at load time when E2E_AUTH_BYPASS=1 is combined with a
 * production environment indicator (NODE_ENV=production or REPLIT_DEPLOYMENT
 * being set). This prevents the dev-only bypass header from silently working
 * against real user traffic.
 *
 * Each test that exercises the guard calls vi.resetModules() so the module is
 * freshly evaluated (the top-level `if` re-runs) with the stubbed env vars in
 * place.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("requireAuth — E2E_AUTH_BYPASS production startup guard", () => {
  it("throws when E2E_AUTH_BYPASS=1 and NODE_ENV=production", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");

    vi.resetModules();
    vi.doMock("@clerk/express", () => ({
      getAuth: vi.fn(() => ({ userId: null })),
      clerkMiddleware: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    }));

    await expect(
      import("../requireAuth.js"),
    ).rejects.toThrow(/E2E_AUTH_BYPASS/);
  });

  it("throws when E2E_AUTH_BYPASS=1 and REPLIT_DEPLOYMENT is set (non-empty)", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");

    vi.resetModules();
    vi.doMock("@clerk/express", () => ({
      getAuth: vi.fn(() => ({ userId: null })),
      clerkMiddleware: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    }));

    await expect(
      import("../requireAuth.js"),
    ).rejects.toThrow(/E2E_AUTH_BYPASS/);
  });

  it("does NOT throw when E2E_AUTH_BYPASS=1 in a non-production environment", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");

    vi.resetModules();
    vi.doMock("@clerk/express", () => ({
      getAuth: vi.fn(() => ({ userId: null })),
      clerkMiddleware: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    }));

    await expect(import("../requireAuth.js")).resolves.toBeDefined();
  });

  it("does NOT throw when NODE_ENV=production but E2E_AUTH_BYPASS is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "production");
    delete process.env["E2E_AUTH_BYPASS"];

    vi.resetModules();
    vi.doMock("@clerk/express", () => ({
      getAuth: vi.fn(() => ({ userId: null })),
      clerkMiddleware: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    }));

    await expect(import("../requireAuth.js")).resolves.toBeDefined();
  });

  it("does NOT throw when E2E_AUTH_BYPASS=0 and NODE_ENV=production", async () => {
    vi.stubEnv("E2E_AUTH_BYPASS", "0");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");

    vi.resetModules();
    vi.doMock("@clerk/express", () => ({
      getAuth: vi.fn(() => ({ userId: null })),
      clerkMiddleware: vi.fn(
        () => (_req: unknown, _res: unknown, next: () => void) => next(),
      ),
    }));

    await expect(import("../requireAuth.js")).resolves.toBeDefined();
  });
});
