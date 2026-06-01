/**
 * efh.test.ts — integration tests for the EFH (Essential Fish Habitat) route.
 *
 * Covers:
 *   GET /efh  — no datasetId → empty collection, known id → features, species filter
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../lib/efhData.js", () => ({
  SALTWATER_EFH_BY_DATASET: {
    "glacier-bay": {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            species: "pcod",
            commonName: "Pacific Cod",
            efhType: "EFH",
            source: "noaa-efh",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: {
            species: "halibut",
            commonName: "Pacific Halibut",
            efhType: "EFH",
            source: "noaa-efh",
          },
        },
      ],
      metadata: {
        datasetId: "glacier-bay",
        creditUrl: "https://example.com",
      },
    },
  },
}));

vi.mock("../../lib/txFreshwaterEfhData.js", () => ({
  TX_FRESHWATER_EFH_BY_DATASET: {},
}));

import efhRouter from "../efh.js";

function makeApp() {
  const app = express();
  app.use(efhRouter);
  return app;
}

describe("GET /efh — no datasetId", () => {
  it("returns an empty FeatureCollection when no datasetId is supplied", async () => {
    const res = await request(makeApp()).get("/efh");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
  });

  it("returns an empty FeatureCollection for an unknown datasetId", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=unknown-dataset");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata.note).toContain("unknown-dataset");
  });
});

describe("GET /efh — valid datasetId", () => {
  it("returns all features for a known datasetId", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(2);
    expect(res.body.metadata).toBeDefined();
  });

  it("returns only matching features when species filter is applied", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=glacier-bay&species=pcod");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.species).toBe("pcod");
  });

  it("returns matching features using commonName (underscore-joined)", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=glacier-bay&species=pacific_halibut");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.commonName).toBe("Pacific Halibut");
  });

  it("returns empty features when species filter matches nothing", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=glacier-bay&species=tuna");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(0);
  });

  it("supports comma-separated species list", async () => {
    const res = await request(makeApp()).get("/efh?datasetId=glacier-bay&species=pcod,halibut");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(2);
  });
});
