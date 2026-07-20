import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import express from "express";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mutable state for controlling db ownership check results
const dbState: { ownerRows: unknown[] } = { ownerRows: [] };

vi.mock("@clerk/express", () => ({
  clerkMiddleware: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  getAuth: vi.fn(() => ({ userId: null })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbState.ownerRows),
      }),
    }),
  },
  customDatasetsTable: { id: "id", userId: "userId", terrainJson: "terrainJson" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("../../lib/terrain.js", () => ({
  BUNDLED_TERRAIN: [],
  NYSDEC_BATHY_FEATURE_SERVICE: "https://mock.invalid/nysdec",
  MN_DNR_BATHY_FEATURE_SERVICE: "https://mock.invalid/mndnr",
  ALL_PRESET_DATASETS: [
    {
      id: "thorne-bay",
      name: "Thorne Bay, SE Alaska",
      bbox: { minLon: -133.1, minLat: 55.6, maxLon: -132.3, maxLat: 55.9 },
      waterType: "saltwater",
    },
    {
      id: "lake-texoma",
      name: "Lake Texoma",
      bbox: { minLon: -97.1, minLat: 33.7, maxLon: -96.5, maxLat: 34.2 },
      waterType: "freshwater",
    },
  ],
}));

const SE_ALASKA_MOCK_FEATURES = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-131.6, 55.3], [-131.61, 55.3], [-131.61, 55.31], [-131.6, 55.3]]] },
    properties: {
      unitId: "SZ-001",
      substrate: "bedrock",
      shoreZoneClass: "Rock Platform",
      cmecsCode: "2.1.1",
      color: "#6b6b6b",
      source: "alaska-shorezone",
      szMaterial: "Rock",
      szForm: "Platform",
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-131.7, 55.35], [-131.71, 55.35], [-131.71, 55.36], [-131.7, 55.35]]] },
    properties: {
      unitId: "SZ-002",
      substrate: "sand",
      shoreZoneClass: "Clastic Beach",
      cmecsCode: "2.2.2",
      color: "#e2d5a0",
      source: "alaska-shorezone",
      szMaterial: "Clastic",
      szForm: "Beach",
    },
  },
];

const MOCK_SLICE_WITH_SE_ALASKA = {
  features: SE_ALASKA_MOCK_FEATURES,
  sources: [{ source: "alaska-shorezone", featureCount: 2 }],
  hasCoverage: true,
  region: "Ketchikan, SE Alaska",
  coverageBbox: { minLon: -131.71, minLat: 55.3, maxLon: -131.6, maxLat: 55.36 },
  nearestCoverageKm: 0,
  nearestSource: null,
};

const MOCK_SLICE_EMPTY = {
  features: [],
  sources: [],
  hasCoverage: false,
  region: "Unknown",
  coverageBbox: null,
  nearestCoverageKm: 0,
  nearestSource: null,
};

const getSubstrateForDatasetMock = vi.fn();

vi.mock("../../lib/shoreZoneData.js", () => ({
  getSubstrateForDataset: (...args: unknown[]) => getSubstrateForDatasetMock(...args),
  AOOS_INTERTIDAL_POW: { features: [], metadata: { sourceName: "AOOS stub", creditUrl: "" } },
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

import intertidalSpotsRouter from "../intertidal-spots.js";
import { getAuth } from "@clerk/express";

let app: express.Application;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(intertidalSpotsRouter);
});

// ── Preset dataset tests ───────────────────────────────────────────────────────

describe("GET /intertidal-spots/:id — preset datasets", () => {
  it("returns 404 for unknown dataset id", async () => {
    const res = await request(app).get("/intertidal-spots/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 200 with a FeatureCollection for a known SE Alaska dataset", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(Array.isArray(res.body.features)).toBe(true);
  });

  it("all returned features have tidepoolScore and beachcombingScore", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay");
    expect(res.status).toBe(200);
    for (const f of res.body.features) {
      expect(typeof f.properties.tidepoolScore).toBe("number");
      expect(typeof f.properties.beachcombingScore).toBe("number");
      expect(f.properties.tidepoolScore).toBeGreaterThanOrEqual(0);
      expect(f.properties.tidepoolScore).toBeLessThanOrEqual(100);
      expect(f.properties.beachcombingScore).toBeGreaterThanOrEqual(0);
      expect(f.properties.beachcombingScore).toBeLessThanOrEqual(100);
    }
  });

  it("type=tidepool only returns features with tidepoolScore >= minScore", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay?type=tidepool&minScore=30");
    expect(res.status).toBe(200);
    for (const f of res.body.features) {
      expect(f.properties.tidepoolScore).toBeGreaterThanOrEqual(30);
    }
  });

  it("type=beachcombing only returns features with beachcombingScore >= minScore", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay?type=beachcombing&minScore=10");
    expect(res.status).toBe(200);
    for (const f of res.body.features) {
      expect(f.properties.beachcombingScore).toBeGreaterThanOrEqual(10);
    }
  });

  it("minScore=100 returns only perfect-score features (likely none)", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay?minScore=100");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    for (const f of res.body.features) {
      const maxScore = Math.max(f.properties.tidepoolScore, f.properties.beachcombingScore);
      expect(maxScore).toBe(100);
    }
  });

  it("features are sorted descending by dominant score for type=tidepool", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay?type=tidepool");
    expect(res.status).toBe(200);
    const scores = res.body.features.map((f: { properties: { tidepoolScore: number } }) => f.properties.tidepoolScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it("returns 400 for invalid type param", async () => {
    const res = await request(app).get("/intertidal-spots/thorne-bay?type=diving");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_params");
  });

  it("metadata includes datasetId and featureCount", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get("/intertidal-spots/thorne-bay");
    expect(res.status).toBe(200);
    expect(res.body.metadata.datasetId).toBe("thorne-bay");
    expect(typeof res.body.metadata.featureCount).toBe("number");
  });
});

// ── UUID / custom-upload tests ─────────────────────────────────────────────────

const INTERTIDAL_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("GET /intertidal-spots/:id — custom dataset (UUID) auth guard", () => {
  it("returns 401 for a UUID-format dataset id when the caller is not authenticated", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    const res = await request(app).get(`/intertidal-spots/${INTERTIDAL_UUID}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthenticated" });
  });

  it("returns 404 when an authenticated user requests a UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [];
    const res = await request(app).get(`/intertidal-spots/${INTERTIDAL_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 with empty FeatureCollection for an owned UUID dataset outside SE Alaska coverage", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{
      userId: "user-a",
      terrainJson: { minLon: -97.1, minLat: 33.7, maxLon: -96.5, maxLat: 34.2 },
    }];
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_EMPTY);
    const res = await request(app).get(`/intertidal-spots/${INTERTIDAL_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata.datasetId).toBe(INTERTIDAL_UUID);
    expect(res.body.metadata.featureCount).toBe(0);
  });

  it("returns 200 with scored features for an owned UUID dataset whose bbox overlaps SE Alaska", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{
      userId: "user-a",
      terrainJson: { minLon: -133.1, minLat: 55.6, maxLon: -132.3, maxLat: 55.9 },
    }];
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_SE_ALASKA);
    const res = await request(app).get(`/intertidal-spots/${INTERTIDAL_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features.length).toBeGreaterThan(0);
    expect(res.body.metadata.datasetId).toBe(INTERTIDAL_UUID);
    for (const f of res.body.features) {
      expect(typeof f.properties.tidepoolScore).toBe("number");
      expect(typeof f.properties.beachcombingScore).toBe("number");
    }
  });
});
