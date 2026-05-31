/**
 * user-datasets.test.ts — unit tests for the user-datasets terrain route.
 *
 * Covers:
 *  1. 413 when pg_column_size pre-check returns a value above MAX_TERRAIN_JSON_BYTES
 *     — verifies the full terrain SELECT is never issued.
 *  2. 404 when the size pre-check finds no matching row.
 *  3. 200 with terrain payload when the blob is within the size limit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ─── Stateful mock control ────────────────────────────────────────────────────
// selectCalls: captures the sequence of calls to db.select().from().where() so
// tests can assert whether the full terrain SELECT was issued after 413.
const state: {
  selectCalls: number;
  // What the first call (size pre-check) should return.
  // undefined → no row (triggers 404)
  // number    → { size: <number> }
  sizeBytes: number | undefined;
} = {
  selectCalls: 0,
  sizeBytes: 1000,
};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const call = ++state.selectCalls;
          if (call === 1) {
            // Size pre-check call.
            if (state.sizeBytes === undefined) return Promise.resolve([]);
            return Promise.resolve([{ size: state.sizeBytes }]);
          }
          // Full terrain fetch call (only reached when size is within limit).
          return Promise.resolve([{ terrainJson: { type: "grid", datasetId: "ds-1" } }]);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}),
  },
  customDatasetsTable: {},
  datasetFoldersTable: {},
  userSettingsTable: {},
  uploadJobsTable: {},
  datasetCatalogTable: {},
  userCatalogSavesTable: {},
  markersTable: {},
}));

vi.mock("@workspace/api-zod", () => ({
  GetUserDatasetsResponse: { parse: (x: unknown) => x },
  GetUserDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
  GetUserDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
  PatchUserDatasetsIdMoveBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
  PatchUserDatasetsIdMoveResponse: { parse: (x: unknown) => x },
  PatchUserDatasetsIdRenameBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
  PatchUserDatasetsIdRenameResponse: { parse: (x: unknown) => x },
  GetDatasetsResponse: { parse: (x: unknown) => x },
  GetDatasetsIdTerrainResponse: { parse: (x: unknown) => x },
  GetDatasetsIdOverviewResponse: { parse: (x: unknown) => x },
  PostDatasetsUploadResponse: { parse: (x: unknown) => x },
  GetMarkersQueryParams: { safeParse: () => ({ success: false }) },
  PostMarkersBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
  DeleteMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdParams: { safeParse: () => ({ success: false }) },
  PatchMarkersIdBody: { safeParse: () => ({ success: false, error: { message: "noop" } }) },
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@workspace/poe", async () => {
  const actual = await vi.importActual<typeof import("@workspace/poe")>("@workspace/poe");
  return { ...actual, getPoeClient: vi.fn(() => ({})) };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import app from "../../app.js";

const E2E_USER = "user_e2e_terrain_test";

beforeEach(() => {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  state.selectCalls = 0;
  state.sizeBytes = 1000;
});

describe("GET /api/user/datasets/:id/terrain — size pre-check", () => {
  it("returns 413 when pg_column_size exceeds MAX_TERRAIN_JSON_BYTES", async () => {
    state.sizeBytes = 41_000_000; // 41 MB > 40 MB limit

    const selectCallsBeforeRequest = state.selectCalls;

    const res = await request(app)
      .get("/api/user/datasets/ds-oversized/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      error: "payload_too_large",
      details: "Dataset is too large to load in the browser. Please contact support.",
    });

    // Only the size pre-check SELECT should have been issued — the full
    // terrain SELECT must NOT be issued when the limit is exceeded.
    expect(state.selectCalls - selectCallsBeforeRequest).toBe(1);
  });

  it("returns 404 when no row matches the id/userId pair", async () => {
    state.sizeBytes = undefined; // mock returns []

    const res = await request(app)
      .get("/api/user/datasets/ds-missing/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 with terrain payload when blob is within the size limit", async () => {
    state.sizeBytes = 1_000_000; // 1 MB — well within the 40 MB limit

    const res = await request(app)
      .get("/api/user/datasets/ds-normal/terrain")
      .set("x-e2e-user-id", E2E_USER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: "grid", datasetId: "ds-1" });

    // Both the pre-check and the full SELECT should have been issued.
    expect(state.selectCalls).toBe(2);
  });

  it("returns 401 when no auth header is present", async () => {
    vi.unstubAllEnvs();

    const res = await request(app).get("/api/user/datasets/ds-any/terrain");

    expect(res.status).toBe(401);
  });
});
