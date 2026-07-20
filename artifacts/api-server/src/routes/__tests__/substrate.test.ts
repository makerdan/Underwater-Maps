/**
 * substrate.test.ts — integration tests for the substrate route.
 *
 * Covers:
 *   GET /substrate/:id — valid id → 200 with GeoJSON, unknown id → 404
 *   GET /substrate/:id — UUID auth guard → 401 (no auth), 404 (non-owner)
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

const getSubstrateForDatasetMock = vi.fn();

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
      id: "glacier-bay",
      name: "Glacier Bay, SE Alaska",
      bbox: { minLon: -137.0, minLat: 58.2, maxLon: -135.0, maxLat: 59.2 },
      waterType: "saltwater",
    },
  ],
}));

vi.mock("../../lib/shoreZoneData.js", () => {
  const bundle = {
    metadata: {
      sourceName: "Alaska ShoreZone",
      sourceLayer: "AK_SZ_ITZ_Polygons",
      sourceService: "https://example.com",
      region: "SE Alaska",
      bbox: { minLon: -137, minLat: 55, maxLon: -130, maxLat: 60 },
      creditUrl: "https://example.com",
      fetchedAt: "2024-01-01",
      source: "alaska-shorezone",
    },
    type: "FeatureCollection",
    features: [],
  };
  return {
    getSubstrateForDataset: (...args: unknown[]) => getSubstrateForDatasetMock(...args),
    ALASKA_SHOREZONE: bundle,
    ENC_SE_ALASKA_SUBSTRATE: bundle,
    ENC_CONUS_SUBSTRATE: bundle,
    TX_LAKE_SUBSTRATE: bundle,
    AOOS_INTERTIDAL_POW: bundle,
  };
});

import substrateRouter from "../substrate.js";

function makeApp() {
  const app = express();
  app.use(substrateRouter);
  return app;
}

const MOCK_SLICE_WITH_FEATURES = {
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: {
        unitId: "SZ-001",
        substrate: "bedrock",
        shoreZoneClass: "Rock Platform",
        cmecsCode: "2.1.1",
        color: "#6b6b6b",
        source: "alaska-shorezone",
      },
    },
  ],
  sources: [{ source: "alaska-shorezone", featureCount: 1 }],
  hasCoverage: true,
  nearestCoverageKm: 0,
  nearestSource: null,
  region: "SE Alaska",
  coverageBbox: { minLon: -137, minLat: 58.2, maxLon: -135, maxLat: 59.2 },
};

const MOCK_SLICE_EMPTY = {
  features: [],
  sources: [],
  hasCoverage: false,
  nearestCoverageKm: 42,
  nearestSource: "alaska-shorezone" as const,
  region: "SE Alaska",
  coverageBbox: null,
};

describe("GET /substrate/:id — parameter validation", () => {
  it("returns 404 for an unknown dataset id", async () => {
    const res = await request(makeApp()).get("/substrate/unknown-dataset");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.details).toContain("unknown-dataset");
  });
});

describe("GET /substrate/:id — happy path", () => {
  it("returns 200 with a GeoJSON FeatureCollection for a known dataset", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_FEATURES);
    const res = await request(makeApp()).get("/substrate/glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);
    expect(res.body.metadata.datasetId).toBe("glacier-bay");
  });

  it("includes featureCount and datasetBbox in the metadata", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_FEATURES);
    const res = await request(makeApp()).get("/substrate/glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.metadata).toHaveProperty("featureCount", 1);
    expect(res.body.metadata).toHaveProperty("datasetBbox");
  });
});

describe("GET /substrate/:id — no coverage", () => {
  it("returns 200 with empty features and nearestCoverage hint when no polygons intersect", async () => {
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_EMPTY);
    const res = await request(makeApp()).get("/substrate/glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata).toHaveProperty("nearestCoverage");
    expect(res.body.metadata.nearestCoverage.distanceKm).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// UUID auth guard — custom (user-uploaded) dataset IDs require auth.
// Preset IDs remain publicly accessible regardless of auth state.
// ---------------------------------------------------------------------------

const SUBSTRATE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

import { getAuth } from "@clerk/express";

describe("GET /substrate/:id — custom dataset (UUID) auth guard", () => {
  it("returns 401 for a UUID-format dataset id when the caller is not authenticated", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    const res = await request(makeApp()).get(`/substrate/${SUBSTRATE_UUID}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthenticated" });
  });

  it("returns 404 when an authenticated user requests a custom UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    // DB ownership check returns no matching row
    dbState.ownerRows = [];
    const res = await request(makeApp()).get(`/substrate/${SUBSTRATE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 with substrate data for an owned custom UUID dataset whose bbox overlaps coverage", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{
      userId: "user-a",
      terrainJson: { minLon: -137.0, minLat: 58.2, maxLon: -135.0, maxLat: 59.2 },
    }];
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_FEATURES);
    const res = await request(makeApp()).get(`/substrate/${SUBSTRATE_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);
    expect(res.body.metadata.datasetId).toBe(SUBSTRATE_UUID);
    expect(res.body.metadata).toHaveProperty("datasetBbox");
  });

  it("returns 200 with empty features and nearestCoverage for an owned custom UUID dataset outside coverage", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{
      userId: "user-a",
      terrainJson: { minLon: -80.0, minLat: 25.0, maxLon: -79.0, maxLat: 26.0 },
    }];
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_EMPTY);
    const res = await request(makeApp()).get(`/substrate/${SUBSTRATE_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata).toHaveProperty("nearestCoverage");
    expect(res.body.metadata.nearestCoverage.distanceKm).toBe(42);
  });

  it("does not require auth for a known preset dataset id", async () => {
    // getAuth returns null (unauthenticated) — preset IDs should still be public
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    getSubstrateForDatasetMock.mockReturnValue(MOCK_SLICE_WITH_FEATURES);
    const res = await request(makeApp()).get("/substrate/glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
  });
});
