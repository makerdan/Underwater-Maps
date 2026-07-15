/**
 * efh.test.ts — integration tests for the EFH (Essential Fish Habitat) route.
 *
 * Covers:
 *   GET /efh  — no datasetId → empty collection, known id → features, species filter
 *   GET /efh/:id — preset datasets (public) and UUID datasets (auth + ownership guard)
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

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
  customDatasetsTable: { id: "id", userId: "userId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-condition"),
  and: vi.fn((...args: unknown[]) => args),
  lt: vi.fn(() => "lt-condition"),
}));

vi.mock("../../lib/terrain.js", () => ({
  ALL_PRESET_DATASETS: [
    {
      id: "glacier-bay",
      name: "Glacier Bay, SE Alaska",
      bbox: { minLon: -137.0, minLat: 58.0, maxLon: -135.0, maxLat: 59.5 },
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

// ── Setup ─────────────────────────────────────────────────────────────────────

import efhRouter from "../efh.js";
import { getAuth } from "@clerk/express";

let app: express.Application;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use(efhRouter);
});

// ── GET /efh (query-param style) ───────────────────────────────────────────────

describe("GET /efh — no datasetId", () => {
  it("returns an empty FeatureCollection when no datasetId is supplied", async () => {
    const res = await request(app).get("/efh");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
  });

  it("returns an empty FeatureCollection for an unknown datasetId", async () => {
    const res = await request(app).get("/efh?datasetId=unknown-dataset");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata.note).toContain("unknown-dataset");
  });
});

describe("GET /efh — valid datasetId", () => {
  it("returns all features for a known datasetId", async () => {
    const res = await request(app).get("/efh?datasetId=glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(2);
    expect(res.body.metadata).toBeDefined();
  });

  it("returns only matching features when species filter is applied", async () => {
    const res = await request(app).get("/efh?datasetId=glacier-bay&species=pcod");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.species).toBe("pcod");
  });

  it("returns matching features using commonName (underscore-joined)", async () => {
    const res = await request(app).get("/efh?datasetId=glacier-bay&species=pacific_halibut");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.commonName).toBe("Pacific Halibut");
  });

  it("returns empty features when species filter matches nothing", async () => {
    const res = await request(app).get("/efh?datasetId=glacier-bay&species=tuna");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(0);
  });

  it("supports comma-separated species list", async () => {
    const res = await request(app).get("/efh?datasetId=glacier-bay&species=pcod,halibut");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(2);
  });
});

// ── GET /efh/:id — preset datasets ────────────────────────────────────────────

describe("GET /efh/:id — preset datasets", () => {
  it("returns 404 for unknown non-UUID dataset id", async () => {
    const res = await request(app).get("/efh/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns 200 with a FeatureCollection for a known preset dataset", async () => {
    const res = await request(app).get("/efh/glacier-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(2);
    expect(res.body.metadata).toBeDefined();
  });

  it("returns 200 with empty FeatureCollection for a preset dataset that has no EFH data", async () => {
    const res = await request(app).get("/efh/lake-texoma");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata.note).toContain("lake-texoma");
  });

  it("species filter applies correctly on the /:id route for a preset", async () => {
    const res = await request(app).get("/efh/glacier-bay?species=pcod");
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.species).toBe("pcod");
  });
});

// ── GET /efh/:id — custom dataset (UUID) auth guard ───────────────────────────

const EFH_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("GET /efh/:id — custom dataset (UUID) auth guard", () => {
  it("returns 401 for a UUID-format dataset id when the caller is not authenticated", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: null } as ReturnType<typeof getAuth>);
    const res = await request(app).get(`/efh/${EFH_UUID}`);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "unauthenticated" });
  });

  it("returns 404 when an authenticated user requests a UUID dataset they do not own", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [];
    const res = await request(app).get(`/efh/${EFH_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not_found" });
  });

  it("returns 200 with empty FeatureCollection for an owned UUID dataset with no bundled EFH data", async () => {
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-a" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{ userId: "user-a" }];
    const res = await request(app).get(`/efh/${EFH_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata.note).toContain(EFH_UUID);
  });

  it("returns 200 with features for an owned UUID dataset that happens to have bundled EFH data", async () => {
    const customUuidWithData = "11111111-2222-3333-4444-555555555555";
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-b" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{ userId: "user-b" }];

    const { EFH_BY_DATASET } = await import("../efh.js");
    (EFH_BY_DATASET as Record<string, unknown>)[customUuidWithData] = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { species: "salmon", commonName: "Chinook Salmon", efhType: "EFH", source: "noaa-efh" },
        },
      ],
      metadata: { datasetId: customUuidWithData, creditUrl: "https://example.com" },
    };

    const res = await request(app).get(`/efh/${customUuidWithData}`);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.species).toBe("salmon");

    delete (EFH_BY_DATASET as Record<string, unknown>)[customUuidWithData];
  });

  it("species filter applies correctly for an owned UUID dataset", async () => {
    const customUuidWithData = "aaaabbbb-cccc-dddd-eeee-ffffffffffff";
    vi.mocked(getAuth).mockReturnValueOnce({ userId: "user-c" } as ReturnType<typeof getAuth>);
    dbState.ownerRows = [{ userId: "user-c" }];

    const { EFH_BY_DATASET } = await import("../efh.js");
    (EFH_BY_DATASET as Record<string, unknown>)[customUuidWithData] = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { species: "pcod", commonName: "Pacific Cod", efhType: "EFH", source: "noaa-efh" },
        },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [] },
          properties: { species: "halibut", commonName: "Pacific Halibut", efhType: "EFH", source: "noaa-efh" },
        },
      ],
      metadata: { datasetId: customUuidWithData, creditUrl: "https://example.com" },
    };

    const res = await request(app).get(`/efh/${customUuidWithData}?species=pcod`);
    expect(res.status).toBe(200);
    expect(res.body.features).toHaveLength(1);
    expect(res.body.features[0].properties.species).toBe("pcod");

    delete (EFH_BY_DATASET as Record<string, unknown>)[customUuidWithData];
  });
});
