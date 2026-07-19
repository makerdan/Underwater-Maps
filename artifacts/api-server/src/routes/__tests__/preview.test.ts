/**
 * preview.test.ts — tests for GET /datasets/:id/preview (task #381).
 *
 * Verifies that the preflight endpoint correctly surfaces each upstream
 * dataSource branch (ncei | gebco | synthetic | unknown) and returns 404
 * for unknown preset IDs.  Also covers the custom UUID dataset branch added
 * to serve My Saves entries owned by the authenticated user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// vi.hoisted is required so these variables are available inside vi.mock()
// factory closures, which are hoisted before module-level const declarations.
const { dbSelectRowsMock, getAuthMock } = vi.hoisted(() => ({
  dbSelectRowsMock: vi.fn<() => Promise<unknown[]>>(),
  getAuthMock: vi.fn<(req: unknown) => { userId: string | null }>(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => dbSelectRowsMock() }) }),
  },
  customDatasetsTable: {},
  userSettingsTable: {},
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
  getAuth: (req: unknown) => getAuthMock(req),
}));

vi.mock("http-proxy-middleware", () => ({
  createProxyMiddleware: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock("@clerk/shared/keys", () => ({
  publishableKeyFromHost: vi.fn(() => "pk_test_mock"),
}));

const previewDatasetMock = vi.fn();
vi.mock("../../lib/terrain.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/terrain.js")>(
    "../../lib/terrain.js",
  );
  return {
    ...actual,
    previewDataset: (id: string) => previewDatasetMock(id),
  };
});

import app from "../../app.js";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  previewDatasetMock.mockReset();
  dbSelectRowsMock.mockResolvedValue([]);
  getAuthMock.mockReturnValue({ userId: null });
});

describe("GET /api/datasets/:id/preview", () => {
  it("returns ncei dataSource without syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "thorne-bay",
      name: "Thorne Bay",
      bbox: { minLon: -1, minLat: 1, maxLon: -2, maxLat: 2 },
      dataSource: "ncei",
    });
    const res = await request(app).get("/api/datasets/thorne-bay/preview");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ datasetId: "thorne-bay", dataSource: "ncei" });
    expect(res.body.syntheticReason).toBeUndefined();
  });

  it("returns gebco dataSource without syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "ds",
      name: "DS",
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dataSource: "gebco",
    });
    const res = await request(app).get("/api/datasets/ds/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("gebco");
  });

  it("returns synthetic dataSource with syntheticReason", async () => {
    previewDatasetMock.mockResolvedValueOnce({
      datasetId: "ds",
      name: "DS",
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dataSource: "synthetic",
      syntheticReason: "Bathymetry data unavailable — terrain is procedurally generated",
    });
    const res = await request(app).get("/api/datasets/ds/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("synthetic");
    expect(res.body.syntheticReason).toMatch(/Bathymetry data unavailable/);
  });

  it("returns 404 for unknown non-UUID dataset ids", async () => {
    previewDatasetMock.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/datasets/does-not-exist/preview");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("falls back to dataSource=unknown when preview throws for any dataset id", async () => {
    previewDatasetMock.mockRejectedValueOnce(new Error("probe blew up"));
    // The catch branch returns a graceful 200 for any id (preset registry is
    // empty in production; user-saved catalog ids must also be served here).
    const res = await request(app).get("/api/datasets/thorne-bay/preview");
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("unknown");
    expect(res.body.syntheticReason).toMatch(/Could not verify/);
    expect(res.body.datasetId).toBe("thorne-bay");
  });
});

describe("GET /api/datasets/:id/preview — custom UUID datasets (My Saves)", () => {
  beforeEach(() => {
    // UUID IDs are never in ALL_PRESET_DATASETS, so previewDataset returns null.
    previewDatasetMock.mockResolvedValue(null);
  });

  it("returns 200 with the dataSource read from terrainJson for authenticated owner", async () => {
    getAuthMock.mockReturnValue({ userId: "user_abc" });
    dbSelectRowsMock.mockResolvedValueOnce([
      {
        name: "My Sonar Survey",
        terrainJson: {
          datasetId: VALID_UUID,
          name: "My Sonar Survey",
          waterType: "saltwater",
          resolution: 256,
          width: 256,
          height: 256,
          depths: [],
          minDepth: -50,
          maxDepth: 0,
          minLon: -122.5,
          maxLon: -122.0,
          minLat: 37.5,
          maxLat: 38.0,
          centerLon: -122.25,
          centerLat: 37.75,
          dataSource: "ncei",
        },
      },
    ]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      datasetId: VALID_UUID,
      name: "My Sonar Survey",
      dataSource: "ncei",
      bbox: { minLon: -122.5, minLat: 37.5, maxLon: -122.0, maxLat: 38.0 },
    });
    expect(res.body.syntheticReason).toBeUndefined();
  });

  it("maps non-standard terrainJson dataSources (twdb, usace, usgs-3dep) to ncei", async () => {
    getAuthMock.mockReturnValue({ userId: "user_abc" });
    dbSelectRowsMock.mockResolvedValueOnce([
      {
        name: "Reservoir Survey",
        terrainJson: {
          datasetId: VALID_UUID,
          name: "Reservoir Survey",
          waterType: "freshwater",
          resolution: 128,
          width: 128,
          height: 128,
          depths: [],
          minDepth: -10,
          maxDepth: 0,
          minLon: -97.0,
          maxLon: -96.5,
          minLat: 30.0,
          maxLat: 30.5,
          centerLon: -96.75,
          centerLat: 30.25,
          dataSource: "twdb",
        },
      },
    ]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("ncei");
  });

  it("returns 200 with dataSource=gebco when terrainJson records gebco", async () => {
    getAuthMock.mockReturnValue({ userId: "user_abc" });
    dbSelectRowsMock.mockResolvedValueOnce([
      {
        name: "GEBCO Dataset",
        terrainJson: {
          datasetId: VALID_UUID,
          name: "GEBCO Dataset",
          waterType: "saltwater",
          resolution: 64,
          width: 64,
          height: 64,
          depths: [],
          minDepth: -200,
          maxDepth: 0,
          minLon: 10.0,
          maxLon: 10.5,
          minLat: 55.0,
          maxLat: 55.5,
          centerLon: 10.25,
          centerLat: 55.25,
          dataSource: "gebco",
        },
      },
    ]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("gebco");
  });

  it("returns 200 with dataSource=ncei when terrainJson has no dataSource field", async () => {
    getAuthMock.mockReturnValue({ userId: "user_abc" });
    dbSelectRowsMock.mockResolvedValueOnce([
      {
        name: "Legacy Upload",
        terrainJson: {
          datasetId: VALID_UUID,
          name: "Legacy Upload",
          waterType: "saltwater",
          resolution: 128,
          width: 128,
          height: 128,
          depths: [],
          minDepth: -30,
          maxDepth: 0,
          minLon: -70.0,
          maxLon: -69.5,
          minLat: 41.5,
          maxLat: 42.0,
          centerLon: -69.75,
          centerLat: 41.75,
        },
      },
    ]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe("ncei");
  });

  it("returns 404 for unauthenticated requests to a UUID dataset", async () => {
    getAuthMock.mockReturnValue({ userId: null });
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 when authenticated but not the owner of the UUID dataset", async () => {
    getAuthMock.mockReturnValue({ userId: "user_other" });
    // DB returns empty — ownership check fails (callerId != row.userId)
    dbSelectRowsMock.mockResolvedValueOnce([]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 404 when UUID does not exist in the database", async () => {
    getAuthMock.mockReturnValue({ userId: "user_abc" });
    dbSelectRowsMock.mockResolvedValueOnce([]);
    const res = await request(app).get(`/api/datasets/${VALID_UUID}/preview`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });
});
