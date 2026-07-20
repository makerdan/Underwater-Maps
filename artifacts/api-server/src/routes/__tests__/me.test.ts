/**
 * Smoke tests for /api/me/export, DELETE /api/me, and the /api/settings
 * passthrough of extra (non-spec) fields. Uses the same Clerk/proxy mock
 * pattern as poe.test.ts and stubs out the DB to keep tests hermetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { __resetRateLimitMemory } from "../../middlewares/rateLimit.js";

// --- DB mock -----------------------------------------------------------------
// Per-table query state. We use shallow proxies that respond to the chained
// drizzle-style API used by the routes under test.
type Row = Record<string, unknown>;
const state: {
  userSettings: Row[];
  markers: Row[];
  customDatasets: Row[];
  gpsTrails: Row[];
  gpsTrailPoints: Row[];
  lastInsertedSettings: Row | null;
  deletes: string[];
} = {
  userSettings: [],
  markers: [],
  customDatasets: [],
  gpsTrails: [],
  gpsTrailPoints: [],
  lastInsertedSettings: null,
  deletes: [],
};

vi.mock("@workspace/db", () => {
  type TableName =
    | "userSettings" | "markers" | "customDatasets"
    | "gpsTrails" | "gpsTrailPoints" | "poeUsageLog";
  const tag = (name: TableName) => ({ __tableName: name });

  const userSettingsTable = tag("userSettings");
  const markersTable = tag("markers");
  const customDatasetsTable = tag("customDatasets");
  const gpsTrailsTable = tag("gpsTrails");
  const gpsTrailPointsTable = tag("gpsTrailPoints");
  const poeUsageLogTable = tag("poeUsageLog");

  const rowsFor = (t: TableName): Row[] => {
    switch (t) {
      case "userSettings": return state.userSettings;
      case "markers": return state.markers;
      case "customDatasets": return state.customDatasets;
      case "gpsTrails": return state.gpsTrails;
      case "gpsTrailPoints": return state.gpsTrailPoints;
      default: return [];
    }
  };

  const select = () => ({
    from: (table: { __tableName: TableName }) => ({
      where: () => Promise.resolve(rowsFor(table.__tableName)),
    }),
  });

  const insert = (table: { __tableName: TableName }) => ({
    values: (row: Row) => {
      const chain = {
        onConflictDoUpdate: ({ set }: { set: Row }) => {
          if (table.__tableName === "userSettings") {
            state.userSettings = [{ ...row, ...set }];
            state.lastInsertedSettings = { ...row, ...set };
          }
          return Promise.resolve([]);
        },
        then: (resolve: (v: unknown) => void) => { resolve([]); },
      };
      return chain;
    },
  });

  const del = (table: { __tableName: TableName }) => ({
    where: () => {
      state.deletes.push(table.__tableName);
      if (table.__tableName === "userSettings") state.userSettings = [];
      if (table.__tableName === "markers") state.markers = [];
      if (table.__tableName === "customDatasets") state.customDatasets = [];
      if (table.__tableName === "gpsTrails") state.gpsTrails = [];
      if (table.__tableName === "gpsTrailPoints") state.gpsTrailPoints = [];
      return Promise.resolve([]);
    },
  });

  return {
    db: { select, insert, delete: del },
    userSettingsTable,
    markersTable,
    customDatasetsTable,
    gpsTrailsTable,
    gpsTrailPointsTable,
    poeUsageLogTable,
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

vi.mock("@workspace/db/schema", () => ({ poeUsageLogTable: { __tableName: "poeUsageLog" } }));

vi.mock("@workspace/api-zod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-zod")>();
  return {
    ...actual,
    ExportUserDataResponse: { parse: (x: unknown) => x },
    DeleteAccountResponse: { parse: (x: unknown) => x },
    GetMarkersResponse: { parse: (x: unknown) => x },
    GetMarkersResponseItem: { parse: (x: unknown) => x },
    PatchMarkersIdResponse: { parse: (x: unknown) => x },
    DeleteMarkersMineResponse: { parse: (x: unknown) => x },
    GetCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponse: { parse: (x: unknown) => x },
    GetMarkersMarkerIdCatchesResponseItem: { parse: (x: unknown) => x },
    PatchCatchesIdResponse: { parse: (x: unknown) => x },
    PostCatchPhotosUploadUrlResponse: { parse: (x: unknown) => x },
    GetRoutesResponse: { parse: (x: unknown) => x },
    GetRoutesResponseItem: { parse: (x: unknown) => x },
    PatchRouteResponse: { parse: (x: unknown) => x },
    GetTrailsResponse: { parse: (x: unknown) => x },
    GetTrailsResponseItem: { parse: (x: unknown) => x },
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

// Mock Clerk + proxy middlewares so the app boots without a live tenant.
vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: vi.fn(() => ({ userId: "user-test" })),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

import app from "../../app.js";

beforeEach(() => {
  state.userSettings = [];
  state.markers = [];
  state.customDatasets = [];
  state.gpsTrails = [];
  state.gpsTrailPoints = [];
  state.lastInsertedSettings = null;
  state.deletes = [];
  vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
  __resetRateLimitMemory();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/me/export", () => {
  it("returns a JSON payload containing the user's data envelope", async () => {
    state.userSettings = [
      { userId: "user-test", settings: { fogDensity: 0.02, customAdvanced: "yes" } },
    ];
    state.markers = [{ id: "m1", userId: "user-test", type: "fish" }];
    state.customDatasets = [
      { id: "d1", userId: "user-test", name: "ds", minDepth: 0, maxDepth: 10, createdAt: new Date() },
    ];

    const res = await request(app).get("/api/me/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment;.*bathyscan-export/);
    expect(res.body.userId).toBe("user-test");
    expect(res.body.settings).toEqual({ fogDensity: 0.02, customAdvanced: "yes" });
    expect(res.body.markers).toHaveLength(1);
    expect(res.body.customDatasets[0].id).toBe("d1");
    expect(res.body.trails).toEqual([]);
  });
});

describe("DELETE /api/me", () => {
  it("deletes the user's settings, markers, datasets and trails", async () => {
    const res = await request(app).delete("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // All four user-owned tables were targeted for deletion.
    expect(state.deletes).toEqual(
      expect.arrayContaining([
        "gpsTrails",
        "markers",
        "customDatasets",
        "userSettings",
      ]),
    );
  });
});

describe("PUT /api/settings passthrough", () => {
  it("persists unknown advanced fields alongside zod-validated fields", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({
        // Known (spec) field
        fogDensity: 0.015,
        // Unknown advanced fields — must survive the round-trip
        fieldOfView: 75,
        showAdvancedEverywhere: true,
        accentColor: "#ff00aa",
      });

    expect(res.status).toBe(200);
    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    expect(persisted).toBeDefined();
    expect(persisted.fogDensity).toBe(0.015);
    expect(persisted.fieldOfView).toBe(75);
    expect(persisted.showAdvancedEverywhere).toBe(true);
    expect(persisted.accentColor).toBe("#ff00aa");
  });

  it("partial PUT preserves previously stored fields not included in the body", async () => {
    // User previously saved units: "imperial" + a few other customizations.
    state.userSettings = [
      {
        userId: "user-test",
        settings: {
          units: "imperial",
          depthUnit: "feet",
          fogDensity: 0.02,
          waterType: "saltwater",
          fieldOfView: 75, // extra (non-spec) advanced field
          __updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ];

    // Partial PUT — only waterType (mimics the HUD water-type toggle).
    const res = await request(app)
      .put("/api/settings")
      .send({ waterType: "freshwater" });
    expect(res.status).toBe(200);

    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    expect(persisted).toBeDefined();
    // The field the client sent is updated.
    expect(persisted.waterType).toBe("freshwater");
    // Previously stored fields the client did NOT send must survive — this is
    // the regression: before the fix the zod-default for `units` ("metric")
    // would clobber the stored "imperial" value.
    expect(persisted.units).toBe("imperial");
    expect(persisted.depthUnit).toBe("feet");
    expect(persisted.fogDensity).toBe(0.02);
    expect(persisted.fieldOfView).toBe(75);
    // Server is the source of truth for __updatedAt; it must advance.
    expect(persisted.__updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("GET /api/settings returns merged extras alongside defaults", async () => {
    state.userSettings = [
      {
        userId: "user-test",
        settings: { fogDensity: 0.02, fieldOfView: 90, customField: "abc" },
      },
    ];
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.fogDensity).toBe(0.02);
    expect(res.body.fieldOfView).toBe(90);
    expect(res.body.customField).toBe("abc");
    // A default-only field should still be present.
    expect(res.body.depthUnit).toBe("metres");
  });
});

describe("zoneOverlaySlots migration", () => {
  it("GET: legacy flat array is promoted to { saltwater, freshwater } on read", async () => {
    const legacySlots = [
      { color: "#aabbcc", visible: true },
      { color: "#112233", visible: false },
      { color: "#445566", visible: true },
      { color: "#778899", visible: true },
    ];
    state.userSettings = [
      { userId: "user-test", settings: { zoneOverlaySlots: legacySlots } },
    ];

    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);

    const zones = res.body.zoneOverlaySlots as {
      saltwater: unknown[];
      freshwater: unknown[];
    };
    // Saltwater should carry the previously-stored flat palette.
    expect(zones.saltwater).toEqual(legacySlots);
    // Freshwater should be filled in with the server default (4 slots).
    expect(Array.isArray(zones.freshwater)).toBe(true);
    expect((zones.freshwater as unknown[]).length).toBe(4);
  });

  it("GET: new { saltwater, freshwater } format is returned unchanged", async () => {
    const saltwaterSlots = [
      { color: "#001122", visible: true },
      { color: "#334455", visible: true },
      { color: "#667788", visible: false },
      { color: "#99aabb", visible: true },
    ];
    const freshwaterSlots = [
      { color: "#aabbcc", visible: true },
      { color: "#ddeeff", visible: false },
      { color: "#112233", visible: true },
      { color: "#445566", visible: true },
    ];
    state.userSettings = [
      {
        userId: "user-test",
        settings: {
          zoneOverlaySlots: { saltwater: saltwaterSlots, freshwater: freshwaterSlots },
        },
      },
    ];

    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);

    const zones = res.body.zoneOverlaySlots as {
      saltwater: unknown[];
      freshwater: unknown[];
    };
    expect(zones.saltwater).toEqual(saltwaterSlots);
    expect(zones.freshwater).toEqual(freshwaterSlots);
  });

  it("GET: missing zoneOverlaySlots falls back to defaults for both water types", async () => {
    state.userSettings = [
      { userId: "user-test", settings: { fogDensity: 0.01 } },
    ];

    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);

    const zones = res.body.zoneOverlaySlots as {
      saltwater: unknown[];
      freshwater: unknown[];
    };
    expect(Array.isArray(zones.saltwater)).toBe(true);
    expect((zones.saltwater as unknown[]).length).toBe(4);
    expect(Array.isArray(zones.freshwater)).toBe(true);
    expect((zones.freshwater as unknown[]).length).toBe(4);
  });

  it("PUT: legacy flat array stored in DB is normalised to object shape on write", async () => {
    const legacySlots = [
      { color: "#aabbcc", visible: true },
      { color: "#112233", visible: false },
      { color: "#445566", visible: true },
      { color: "#778899", visible: true },
    ];
    // Simulate a row that was written before the per-water-type split.
    state.userSettings = [
      { userId: "user-test", settings: { zoneOverlaySlots: legacySlots } },
    ];

    // Any PUT triggers the merge + migration path.
    const res = await request(app)
      .put("/api/settings")
      .send({ fogDensity: 0.025 });
    expect(res.status).toBe(200);

    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    const zones = persisted.zoneOverlaySlots as {
      saltwater: unknown[];
      freshwater: unknown[];
    };
    expect(zones.saltwater).toEqual(legacySlots);
    expect(Array.isArray(zones.freshwater)).toBe(true);
    expect((zones.freshwater as unknown[]).length).toBe(4);
  });

  it("PUT: freshwater palette sent explicitly by the client is persisted", async () => {
    const freshwaterSlots = [
      { color: "#ff0000", visible: true },
      { color: "#00ff00", visible: true },
      { color: "#0000ff", visible: false },
      { color: "#ffff00", visible: true },
    ];
    const saltwaterSlots = [
      { color: "#001122", visible: true },
      { color: "#334455", visible: true },
      { color: "#667788", visible: true },
      { color: "#99aabb", visible: true },
    ];

    const res = await request(app)
      .put("/api/settings")
      .send({
        zoneOverlaySlots: { saltwater: saltwaterSlots, freshwater: freshwaterSlots },
      });
    expect(res.status).toBe(200);

    const persisted = state.lastInsertedSettings?.["settings"] as Record<string, unknown>;
    const zones = persisted.zoneOverlaySlots as {
      saltwater: unknown[];
      freshwater: unknown[];
    };
    expect(zones.saltwater).toEqual(saltwaterSlots);
    expect(zones.freshwater).toEqual(freshwaterSlots);
  });
});
