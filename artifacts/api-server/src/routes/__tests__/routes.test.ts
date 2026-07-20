/**
 * routes.test.ts — integration tests for GET / POST / PATCH / DELETE /api/routes
 *
 * Covers:
 *  - 401 for unauthenticated callers on every endpoint
 *  - 400 for missing / malformed request data
 *  - GET returns only the calling user's routes for the requested datasetId
 *  - POST creates a route and returns 201
 *  - PATCH renames a route the user owns; 404 for unknown or other-user's route
 *  - DELETE removes the route; 404 for unknown or other-user's route (ownership)
 *
 * The handler uses drizzle's `and(eq(...), eq(...))` conditions which the
 * mock cannot introspect. The mock instead filters by `currentUserId` (set
 * in the clerk mock) to simulate per-user isolation, which is sufficient
 * because each test controls which rows exist in `state.routes`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// No factory — Vitest resolves this to src/lib/__mocks__/logger.ts, which
// provides a recursive child() mock matching real pino behaviour (including
// child().child() chains that pino-http v10+ calls on every request).
// Do NOT add a separate pino-http mock factory in this file — the shared
// logger mock is sufficient because pino-http calls logger.child({req}) from
// the already-mocked logger. Adding a factory also breaks check:bare-pino-http-mock.
vi.mock("../../lib/logger.js");
import { logger } from "../../lib/logger.js";

type RouteRow = Record<string, unknown>;

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const state: {
  routes: RouteRow[];
} = {
  routes: [],
};

vi.mock("@workspace/db", () => {
  const routesTable = { __tableName: "routes" as const };

  const select = () => ({
    from: () => ({
      where: () => ({
        orderBy: () =>
          Promise.resolve(
            state.routes.filter((r) => r["userId"] === currentUserId),
          ),
      }),
    }),
  });

  const insert = () => ({
    values: (row: RouteRow) => ({
      returning: () => {
        const created: RouteRow = {
          ...row,
          id: VALID_UUID,
          createdAt: new Date().toISOString(),
        };
        state.routes.push(created);
        return Promise.resolve([created]);
      },
    }),
  });

  const update = () => ({
    set: (data: RouteRow) => ({
      where: () => ({
        returning: () => {
          const idx = state.routes.findIndex(
            (r) => r["userId"] === currentUserId,
          );
          if (idx === -1) return Promise.resolve([]);
          state.routes[idx] = { ...state.routes[idx], ...data };
          return Promise.resolve([state.routes[idx]]);
        },
      }),
    }),
  });

  const del = () => ({
    where: () => ({
      returning: () => {
        const before = state.routes.length;
        state.routes = state.routes.filter(
          (r) => r["userId"] !== currentUserId,
        );
        const removed = before - state.routes.length;
        return Promise.resolve(removed > 0 ? [{ id: VALID_UUID }] : []);
      },
    }),
  });

  const stub = () => ({
    from: () => ({ where: () => Promise.resolve([]) }),
    values: () => ({ returning: () => Promise.resolve([]) }),
    set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    where: () => Promise.resolve([]),
  });

  return {
    db: {
      select,
      insert,
      update,
      delete: del,
      transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(stub()),
    },
    routesTable,
    markersTable: {},
    userSettingsTable: {},
    userCatalogSavesTable: {},
    customDatasetsTable: {},
    datasetFoldersTable: {},
    datasetCatalogTable: {},
    gpsTrailsTable: {},
    gpsTrailPointsTable: {},
    trollingPresetsTable: {},
    trollingPresetFoldersTable: {},
    poeUsageLogTable: {},
    pool: {},
  };
});

let currentUserId: string | null = "user-a";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: currentUserId })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => null,
  eq: (..._args: unknown[]) => null,
}));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    GetRoutesResponse: { parse: (x: unknown) => x },
    GetRoutesResponseItem: { parse: (x: unknown) => x },
    PatchRouteResponse: { parse: (x: unknown) => x },
    GetMarkersResponse: { parse: (x: unknown) => x },
    GetMarkersResponseItem: { parse: (x: unknown) => x },
    PatchMarkersIdResponse: { parse: (x: unknown) => x },
    DeleteMarkersMineResponse: { parse: (x: unknown) => x },
    GetCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchCatchesIdResponse: { parse: (x: unknown) => x },
    PostCatchPhotosUploadUrlResponse: { parse: (x: unknown) => x },
    GetTrailsResponse: { parse: (x: unknown) => x },
    GetTrailsResponseItem: { parse: (x: unknown) => x },
    ExportUserDataResponse: { parse: (x: unknown) => x },
    DeleteAccountResponse: { parse: (x: unknown) => x },
    PostUserDatasetsIdGeorefResponse: { parse: (x: unknown) => x },
    GetUserDatasetsIdHyd93FeaturesResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogResponse: { parse: (x: unknown) => x },
    GetDatasetsCatalogSearchResponse: { parse: (x: unknown) => x },
    PostDatasetsBboxQueryResponse: { parse: (x: unknown) => x },
    PostDatasetsPointRadiusQueryResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponse: { parse: (x: unknown) => x },
    GetDatasetsMySavesResponseItem: { parse: (x: unknown) => x },
    GetDatasetsMySavesIdStatusResponse: { parse: (x: unknown) => x },
    PostDatasetsMySavesIdRetryResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdRenameResponse: { parse: (x: unknown) => x },
    PatchDatasetsMySavesIdMoveResponse: { parse: (x: unknown) => x },
    GetDatasetZonesResponse: { parse: (x: unknown) => x },
    GetTerrainLandResponse: { parse: (x: unknown) => x },
    GetDatasetsIdPreviewResponse: { parse: (x: unknown) => x },
    GetTerrainDownloadInfoResponse: { parse: (x: unknown) => x },
    GetUploadJobStatusResponse: { parse: (x: unknown) => x },
  };
});

import app from "../../app.js";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

const SAMPLE_WAYPOINTS = [
  { lon: -122.0, lat: 37.0, depth: 10 },
  { lon: -122.1, lat: 37.1, depth: 20 },
];

beforeEach(() => {
  __resetRateLimitMemory();
  state.routes = [];
  currentUserId = "user-a";
  vi.mocked(logger.warn).mockClear();
});

// ─── GET /api/routes ─────────────────────────────────────────────────────────

describe("GET /api/routes", () => {
  it("returns 401 when not authenticated", async () => {
    currentUserId = null;
    const res = await request(app).get("/api/routes?datasetId=ds-1");
    expect(res.status).toBe(401);
  });

  it("returns 400 when datasetId query param is missing", async () => {
    const res = await request(app).get("/api/routes");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when datasetId is an empty string", async () => {
    const res = await request(app).get("/api/routes?datasetId=");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns an empty array when no routes exist", async () => {
    const res = await request(app).get("/api/routes?datasetId=ds-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only the calling user's routes (not other users')", async () => {
    state.routes = [
      {
        id: VALID_UUID,
        userId: "user-a",
        datasetId: "ds-1",
        name: "My Route",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 5000,
        createdAt: new Date().toISOString(),
      },
      {
        id: "11111111-2222-3333-4444-555555555555",
        userId: "user-b",
        datasetId: "ds-1",
        name: "Other Route",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 3000,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(app).get("/api/routes?datasetId=ds-1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "My Route", userId: "user-a" });
  });
});

// ─── POST /api/routes ─────────────────────────────────────────────────────────

describe("POST /api/routes", () => {
  it("returns 401 when not authenticated", async () => {
    currentUserId = null;
    const res = await request(app).post("/api/routes").send({
      datasetId: "ds-1",
      name: "New Route",
      waypoints: SAMPLE_WAYPOINTS,
      totalDistanceM: 5000,
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await request(app).post("/api/routes").send({
      name: "No Dataset",
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("emits logger.warn with route label when body fails Zod validation", async () => {
    const res = await request(app).post("/api/routes").send({ name: "No Dataset" });
    expect(res.status).toBe(400);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ route: "POST /api/routes" }),
      expect.stringContaining("POST /api/routes"),
    );
  });

  it("returns 400 when name is empty", async () => {
    const res = await request(app).post("/api/routes").send({
      datasetId: "ds-1",
      name: "",
      waypoints: SAMPLE_WAYPOINTS,
      totalDistanceM: 5000,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when fewer than 2 waypoints are supplied", async () => {
    const res = await request(app).post("/api/routes").send({
      datasetId: "ds-1",
      name: "Single Waypoint",
      waypoints: [{ lon: -122.0, lat: 37.0, depth: 10 }],
      totalDistanceM: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("creates a route and returns 201 with the new row", async () => {
    const res = await request(app).post("/api/routes").send({
      datasetId: "ds-1",
      name: "Reef Run",
      waypoints: SAMPLE_WAYPOINTS,
      totalDistanceM: 5000,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Reef Run",
      datasetId: "ds-1",
      userId: "user-a",
      waypointCount: 2,
      totalDistanceM: 5000,
    });
    expect(state.routes).toHaveLength(1);
  });
});

// ─── PATCH /api/routes/:id ────────────────────────────────────────────────────

describe("PATCH /api/routes/:id", () => {
  it("returns 401 when not authenticated", async () => {
    currentUserId = null;
    const res = await request(app)
      .patch(`/api/routes/${VALID_UUID}`)
      .send({ name: "Updated" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the route id is not a valid UUID", async () => {
    const res = await request(app)
      .patch("/api/routes/not-a-uuid")
      .send({ name: "Updated" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 when the name field is missing or empty", async () => {
    const res = await request(app)
      .patch(`/api/routes/${VALID_UUID}`)
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 404 when the route belongs to a different user (ownership)", async () => {
    state.routes = [
      {
        id: VALID_UUID,
        userId: "user-b",
        datasetId: "ds-1",
        name: "Someone Else",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 1000,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(app)
      .patch(`/api/routes/${VALID_UUID}`)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
    expect(state.routes[0]).toMatchObject({ name: "Someone Else" });
  });

  it("renames the route and returns the updated row", async () => {
    state.routes = [
      {
        id: VALID_UUID,
        userId: "user-a",
        datasetId: "ds-1",
        name: "Old Name",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 1000,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(app)
      .patch(`/api/routes/${VALID_UUID}`)
      .send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "New Name" });
  });
});

// ─── DELETE /api/routes/:id ───────────────────────────────────────────────────

describe("DELETE /api/routes/:id", () => {
  it("returns 401 when not authenticated", async () => {
    currentUserId = null;
    const res = await request(app).delete(`/api/routes/${VALID_UUID}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when the route id is not a valid UUID", async () => {
    const res = await request(app).delete("/api/routes/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_request" });
  });

  it("returns 404 when the route doesn't exist", async () => {
    const res = await request(app).delete(`/api/routes/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 when the route belongs to a different user (ownership)", async () => {
    state.routes = [
      {
        id: VALID_UUID,
        userId: "user-b",
        datasetId: "ds-1",
        name: "Other User Route",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 1000,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(app).delete(`/api/routes/${VALID_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
    expect(state.routes).toHaveLength(1);
  });

  it("deletes the route and returns 204 on success", async () => {
    state.routes = [
      {
        id: VALID_UUID,
        userId: "user-a",
        datasetId: "ds-1",
        name: "My Route",
        waypoints: SAMPLE_WAYPOINTS,
        waypointCount: 2,
        totalDistanceM: 1000,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(app).delete(`/api/routes/${VALID_UUID}`);
    expect(res.status).toBe(204);
    expect(state.routes).toHaveLength(0);
  });
});
