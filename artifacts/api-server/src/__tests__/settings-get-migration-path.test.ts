/**
 * settings-get-migration-path.test.ts
 *
 * Verifies that GET /api/settings returns 200 (not 500) when the stored row
 * contains values that require the migration shim — specifically the v18→v19
 * `zoneOverlaySlots` promotion from array to object shape.
 *
 * This test guards against regressions introduced by the type-safety change
 * (replacing `as Record<string,unknown>` on the parse result) — if the
 * narrowed type breaks the downstream merge path the server would 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const migrationMocks = vi.hoisted(() => {
  const selectWhereMock = vi.fn().mockResolvedValue([
    {
      settings: {
        // Old array shape for zoneOverlaySlots — triggers the migration shim
        // in GET /api/settings.
        zoneOverlaySlots: [
          { color: "#f5d58a", visible: true },
          { color: "#c49a6c", visible: true },
          { color: "#8ab4d0", visible: true },
          { color: "#b06060", visible: true },
        ],
        // A valid field alongside the old-format field
        textureQuality: "high",
      },
    },
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
      select: vi.fn().mockReturnValue({ from: migrationMocks.fromMock }),
      insert: vi.fn().mockReturnValue({ values: migrationMocks.valuesMock }),
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

const AUTH = { "x-mock-clerk-user-id": "user_migration_path_test" };

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "");
});

describe("GET /api/settings — migration-path row returns 200", () => {
  it("returns 200 when stored zoneOverlaySlots is old array shape (triggers migration shim)", async () => {
    const res = await request(app)
      .get("/api/settings")
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("textureQuality");
  });

  it("response body includes the migrated zoneOverlaySlots as an object (not array)", async () => {
    const res = await request(app)
      .get("/api/settings")
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.zoneOverlaySlots)).toBe(false);
    expect(typeof res.body.zoneOverlaySlots).toBe("object");
    expect(res.body.zoneOverlaySlots).toHaveProperty("saltwater");
    expect(res.body.zoneOverlaySlots).toHaveProperty("freshwater");
  });
});
