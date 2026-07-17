/**
 * ncei-validation.test.ts — HTTP validation tests for GET /api/ncei/search
 *
 * Covers the NceiSearchQuerySchema safeParse layer without making real
 * upstream requests. `fetch` is stubbed to return a valid empty-hits payload
 * so the validation path is exercised cleanly.
 *
 * Validated cases:
 *  - Valid minimal request (no bbox, no q) → 200 with empty array
 *  - Invalid bbox: only 3 comma-separated values → 400
 *  - Invalid bbox: non-numeric second coordinate → 400
 *  - `from` below minimum (0) → 400
 *  - `max` above cap (101) → 400
 *  - `max` as non-numeric string → 400
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  datasetCatalogTable: {},
  userCatalogSavesTable: {},
  customDatasetsTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  datasetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
}));

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

const EMPTY_NCEI_RESPONSE = { hits: { total: { value: 0 }, hits: [] } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => EMPTY_NCEI_RESPONSE,
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

import app from "../../app.js";

describe("GET /api/ncei/search — query param validation", () => {
  it("returns 200 with an empty array for a minimal valid request", async () => {
    const res = await request(app).get("/api/ncei/search");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns 400 when bbox has only 3 parts (missing maxLat)", async () => {
    const res = await request(app).get("/api/ncei/search?bbox=-136,58,-130");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 400 when bbox contains a non-numeric coordinate", async () => {
    const res = await request(app).get("/api/ncei/search?bbox=-136,not-a-number,-130,60");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 400 when `from` is 0 (must be >= 1)", async () => {
    const res = await request(app).get("/api/ncei/search?from=0");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 400 when `max` exceeds the 100-result cap", async () => {
    const res = await request(app).get("/api/ncei/search?max=101");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("returns 400 when `max` is a non-numeric string", async () => {
    const res = await request(app).get("/api/ncei/search?max=all");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_params" });
  });

  it("passes a valid bbox through without error", async () => {
    const res = await request(app).get("/api/ncei/search?bbox=-136,54,-130,60&q=bathymetry");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
