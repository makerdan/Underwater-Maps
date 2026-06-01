/**
 * substrate.test.ts — integration tests for the substrate route.
 *
 * Covers:
 *   GET /substrate/:id — valid id → 200 with GeoJSON, unknown id → 404
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

const getSubstrateForDatasetMock = vi.fn();

vi.mock("../../lib/terrain.js", () => ({
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
