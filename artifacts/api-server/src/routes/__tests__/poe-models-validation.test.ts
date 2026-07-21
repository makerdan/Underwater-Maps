/**
 * poe-models-validation.test.ts — validation policy for GET /api/poe/models
 *
 * The models endpoint proxies Poe's catalog and uses a LENIENT
 * consumed-fields schema (only `data[].id` is validated). This suite pins
 * that policy:
 *  - Benign upstream additions (unknown top-level fields, unknown per-model
 *    metadata, brand-new models) never cause a 500/502 — the raw payload is
 *    forwarded untouched.
 *  - Payloads that break the consumed fields (data not an array, models
 *    without a string id) return 502 and are NOT cached.
 *  - Network/timeout failures return 502.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  userSettingsTable: { userId: "__col__" },
  markersTable: {},
  routesTable: {},
  gpsTrailsTable: {},
  gpsTrailPointsTable: {},
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userCatalogSavesTable: {},
  datasetCatalogTable: {},
  trollingPresetsTable: {},
  trollingPresetFoldersTable: {},
  poeUsageLogTable: {},
  pool: {},
  rateLimitEventsTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "user-models-test" })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("../../lib/logger.js");

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";
import { __resetPoeModelsCacheForTests } from "../poe.js";

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function mockUpstreamJson(payload: unknown): void {
  fetchMock.mockResolvedValue({
    json: async () => payload,
  } as unknown as Response);
}

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
  __resetPoeModelsCacheForTests();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

function getModels() {
  return request(app)
    .get("/api/poe/models")
    .set("x-e2e-user-id", "user-models-test");
}

describe("GET /api/poe/models — lenient consumed-fields validation policy", () => {
  it("forwards a payload with unknown extra fields and unknown models untouched (200)", async () => {
    const payload = {
      object: "list",
      // Hypothetical future top-level additions from Poe:
      pagination: { nextCursor: "abc123" },
      catalog_version: 42,
      data: [
        {
          id: "Claude-Sonnet-4.5",
          object: "model",
          owned_by: "anthropic",
          // Hypothetical future per-model additions:
          context_window: 200000,
          modalities: ["text", "image"],
          pricing: { input: 6, output: 30 },
        },
        {
          // A brand-new model missing legacy fields like owned_by/object —
          // only `id` is consumed, so this must still pass.
          id: "SomeBrandNewModel-9000",
          release_stage: "beta",
        },
      ],
    };
    mockUpstreamJson(payload);

    const res = await getModels();
    expect(res.status).toBe(200);
    // Pass-through: unknown fields must survive verbatim.
    expect(res.body).toEqual(payload);
  });

  it("serves subsequent requests from cache without re-fetching", async () => {
    const payload = { data: [{ id: "Claude-Haiku-4.5", extra: true }] };
    mockUpstreamJson(payload);

    const first = await getModels();
    expect(first.status).toBe(200);
    const second = await getModels();
    expect(second.status).toBe(200);
    expect(second.body).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when a model entry is missing its id (consumed field broken)", async () => {
    mockUpstreamJson({ data: [{ object: "model", owned_by: "poe" }] });

    const res = await getModels();
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "models_unavailable" });
  });

  it("returns 502 when data is not an array (consumed field broken)", async () => {
    mockUpstreamJson({ data: { totally: "wrong" } });

    const res = await getModels();
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "models_unavailable" });
  });

  it("does not cache a broken payload — a healed upstream recovers on the next request", async () => {
    mockUpstreamJson({ data: [{ no_id: true }] });
    const bad = await getModels();
    expect(bad.status).toBe(502);

    const healed = { data: [{ id: "GPT-5.4" }] };
    mockUpstreamJson(healed);
    const good = await getModels();
    expect(good.status).toBe(200);
    expect(good.body).toEqual(healed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when the upstream fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const res = await getModels();
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "models_unavailable" });
  });

  it("accepts a payload with no data field at all (data is optional)", async () => {
    const payload = { object: "list", note: "empty catalog" };
    mockUpstreamJson(payload);

    const res = await getModels();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });
});
