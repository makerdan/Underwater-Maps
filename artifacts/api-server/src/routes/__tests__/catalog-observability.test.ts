/**
 * catalog-observability.test.ts
 *
 * Tests for two observability/hardening improvements in the catalog layer:
 *
 * 1. Seeding/recovery failure logging (SEED F-009):
 *    - `recoverStuckSaves` catches DB errors and emits logger.error so
 *      failures never silently disappear.
 *
 * 2. Catalog read rate-limit (SEED F-010):
 *    - GET /datasets/catalog, GET /datasets/catalog/search, and
 *      POST /datasets/bbox-query all enforce a per-IP limit and return 429
 *      once the bucket is exhausted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

const mockDbUpdate = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  }),
);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: mockDbUpdate,
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
  userCatalogSavesTable: {
    status: "status",
    userId: "userId",
    catalogId: "catalogId",
    requestBboxJson: "requestBboxJson",
    requestedAt: "requestedAt",
    folderId: "folderId",
    id: "id",
  },
  datasetFoldersTable: {},
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

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

vi.mock("../../lib/catalogSeeder.js", () => ({
  seedDatasetCatalog: vi.fn(async () => {}),
  getCatalogEntries: vi.fn(async () => []),
  searchCatalog: vi.fn(async () => []),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { logger } from "../../lib/logger.js";
import {
  __resetRateLimitMemory,
  __prefillRateLimitMemory,
} from "../../middlewares/rateLimit.js";
import {
  recoverStuckSaves,
  CATALOG_READ_ROUTE,
  CATALOG_READ_WINDOW_MS,
  CATALOG_READ_MAX,
} from "../../routes/catalog-saves.js";
import app from "../../app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** IP address used by supertest requests (loopback). */
const TEST_IP = "127.0.0.1";

/**
 * Build the bucket key for catalog-read IP rate limiting.
 * Key format: `i:<route>:<ip>`.
 */
function catalogReadKey(ip = TEST_IP): string {
  return `i:${CATALOG_READ_ROUTE}:${ip}`;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetRateLimitMemory();
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
  mockDbUpdate.mockReturnValue({
    set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// 1. Seeding / recovery failure logging
// ---------------------------------------------------------------------------

describe("recoverStuckSaves — failure logging", () => {
  it("emits logger.error when the DB update throws (not a silent swallow)", async () => {
    mockDbUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(new Error("DB unavailable")),
        }),
      }),
    });

    await recoverStuckSaves();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("recoverStuckSaves failed"),
    );
  });

  it("does not throw to the caller when the DB is unavailable", async () => {
    mockDbUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(new Error("connection refused")),
        }),
      }),
    });

    await expect(recoverStuckSaves()).resolves.toBeUndefined();
  });

  it("does NOT call logger.error when recoverStuckSaves completes successfully", async () => {
    await recoverStuckSaves();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Catalog read endpoints — per-IP rate limit
// ---------------------------------------------------------------------------

describe("GET /api/datasets/catalog — rate limit", () => {
  it("returns 200 on the first request within the window", async () => {
    const res = await request(app).get("/api/datasets/catalog");
    expect(res.status).toBe(200);
  });

  it("returns 429 when the per-IP bucket is exhausted", async () => {
    __prefillRateLimitMemory(catalogReadKey(), CATALOG_READ_MAX, CATALOG_READ_WINDOW_MS);

    const res = await request(app).get("/api/datasets/catalog");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limit");
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("sets X-RateLimit-Limit header on every response", async () => {
    const res = await request(app).get("/api/datasets/catalog");
    expect(res.headers["x-ratelimit-limit"]).toBe(String(CATALOG_READ_MAX));
  });
});

describe("GET /api/datasets/catalog/search — rate limit", () => {
  it("returns 429 when the per-IP bucket is exhausted", async () => {
    __prefillRateLimitMemory(catalogReadKey(), CATALOG_READ_MAX, CATALOG_READ_WINDOW_MS);

    const res = await request(app).get("/api/datasets/catalog/search?q=bay");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limit");
  });
});

describe("POST /api/datasets/bbox-query — rate limit", () => {
  const VALID_BBOX = { north: 55.8, south: 55.6, east: -132.3, west: -132.6 };

  it("returns 429 when the per-IP bucket is exhausted", async () => {
    __prefillRateLimitMemory(catalogReadKey(), CATALOG_READ_MAX, CATALOG_READ_WINDOW_MS);

    const res = await request(app).post("/api/datasets/bbox-query").send(VALID_BBOX);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limit");
  });

  it("returns 200 when the bucket is not exhausted", async () => {
    const res = await request(app).post("/api/datasets/bbox-query").send(VALID_BBOX);
    expect(res.status).toBe(200);
  });
});

describe("catalog read rate limit — shared bucket across endpoints", () => {
  it("exhausting the limit on /catalog also blocks /catalog/search", async () => {
    __prefillRateLimitMemory(catalogReadKey(), CATALOG_READ_MAX, CATALOG_READ_WINDOW_MS);
    const catalogRes = await request(app).get("/api/datasets/catalog");
    expect(catalogRes.status).toBe(429);

    // Re-prefill to account for the slot consumed by the blocked request.
    __prefillRateLimitMemory(catalogReadKey(), CATALOG_READ_MAX, CATALOG_READ_WINDOW_MS);
    const searchRes = await request(app).get("/api/datasets/catalog/search");
    expect(searchRes.status).toBe(429);
  });
});
