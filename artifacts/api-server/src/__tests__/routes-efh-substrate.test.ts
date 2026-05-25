/**
 * Integration tests for Task #29 API routes:
 *   GET /efh — Essential Fish Habitat GeoJSON
 *   GET /substrate/:id — terrain-derived CMECS substrate GeoJSON
 *
 * The substrate route calls buildTerrainGrid which may fetch from the network.
 * We mock the terrain module so tests run fast and deterministically.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mock terrain module before importing app
// ---------------------------------------------------------------------------

vi.mock("../lib/terrain.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/terrain.js")>();

  // Minimal 4×4 synthetic grid for substrate tests
  const N = 4;
  const depths: number[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      // Mix of shallow / deep to exercise sand + mud classification
      depths.push(r < 2 ? 50 : 150);
    }
  }

  const mockGrid = {
    datasetId: "thorne-bay",
    resolution: N,
    width: N,
    height: N,
    minLon: -133.0,
    maxLon: -132.0,
    minLat: 55.0,
    maxLat: 56.0,
    depths,
    minDepth: 50,
    maxDepth: 150,
    synthetic: true,
    dataSource: "synthetic" as const,
  };

  return {
    ...actual,
    buildTerrainGrid: vi.fn().mockResolvedValue(mockGrid),
  };
});

// ---------------------------------------------------------------------------
// Import app after mocks are registered
// ---------------------------------------------------------------------------
import app from "../app.js";

// ---------------------------------------------------------------------------
// /efh tests
// ---------------------------------------------------------------------------

describe("GET /efh", () => {
  it("returns all Thorne Bay EFH features when called with no datasetId", async () => {
    const res = await request(app).get("/api/efh");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(Array.isArray(res.body.features)).toBe(true);
    expect(res.body.features.length).toBe(5);
  });

  it("returns all features when datasetId=thorne-bay", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay");
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(5);
  });

  it("returns empty features for unsupported datasetId", async () => {
    const res = await request(app).get("/api/efh?datasetId=mariana-trench");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(res.body.features).toHaveLength(0);
    expect(res.body.metadata?.note).toContain("thorne-bay");
  });

  it("includes all five expected species", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay");
    const names = res.body.features.map((f: { properties: { commonName: string } }) => f.properties.commonName);
    expect(names).toContain("Pacific Halibut");
    expect(names).toContain("Pacific Cod");
    expect(names).toContain("Yelloweye Rockfish");
    expect(names).toContain("Dungeness Crab");
    expect(names).toContain("Chinook Salmon");
  });

  it("filters by species scientific name", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay&species=hippoglossus_stenolepis");
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(1);
    expect(res.body.features[0].properties.commonName).toBe("Pacific Halibut");
  });

  it("filters by common name (lowercase, underscore-separated)", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay&species=pacific_halibut");
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(1);
    expect(res.body.features[0].properties.species).toBe("hippoglossus_stenolepis");
  });

  it("filters by multiple species returns correct count", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay&species=hippoglossus_stenolepis,gadus_macrocephalus");
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(2);
  });

  it("each feature has valid GeoJSON Polygon geometry", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay");
    for (const feature of res.body.features) {
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("Polygon");
      expect(Array.isArray(feature.geometry.coordinates)).toBe(true);
      expect(feature.geometry.coordinates[0].length).toBeGreaterThanOrEqual(4);
    }
  });

  it("each feature has a color property for rendering", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay");
    for (const feature of res.body.features) {
      expect(typeof feature.properties.color).toBe("string");
      expect(feature.properties.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("includes metadata with NOAA credit URL", async () => {
    const res = await request(app).get("/api/efh?datasetId=thorne-bay");
    expect(res.body.metadata).toBeDefined();
    const meta = res.body.metadata as Record<string, unknown>;
    const hasCredit = JSON.stringify(meta).includes("fisheries.noaa.gov");
    expect(hasCredit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /substrate/:id tests
// ---------------------------------------------------------------------------

describe("GET /substrate/:id", () => {
  it("returns 404 for unknown datasetId", async () => {
    const res = await request(app).get("/api/substrate/nonexistent-dataset");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns a GeoJSON FeatureCollection for thorne-bay", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("FeatureCollection");
    expect(Array.isArray(res.body.features)).toBe(true);
  });

  it("returns N×N features (one per grid cell)", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    // Mock grid is 4×4
    expect(res.body.features.length).toBe(16);
  });

  it("each feature is a valid GeoJSON polygon", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    for (const feature of res.body.features) {
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("Polygon");
      // Ring should be closed (5 points for a bbox polygon)
      expect(feature.geometry.coordinates[0].length).toBe(5);
    }
  });

  it("each feature has a substrate property (sand or mud for flat terrain)", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    const validSubstrates = new Set(["bedrock", "gravel", "sand", "mud"]);
    for (const feature of res.body.features) {
      expect(validSubstrates.has(feature.properties.substrate)).toBe(true);
    }
  });

  it("shallow cells (depth=50) are classified as sand", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    // Mock grid: rows 0-1 have depth=50 (sand), rows 2-3 have depth=150 (mud)
    const shallowCells = res.body.features.slice(0, 8);
    for (const cell of shallowCells) {
      // Flat synthetic terrain → sand (depth ≤ 80 m)
      expect(cell.properties.substrate).toBe("sand");
    }
  });

  it("deep cells (depth=150) are classified as mud", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    const deepCells = res.body.features.slice(8, 16);
    for (const cell of deepCells) {
      expect(cell.properties.substrate).toBe("mud");
    }
  });

  it("features include slopeAngleDeg and depthM", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    for (const feature of res.body.features) {
      expect(typeof feature.properties.slopeAngleDeg).toBe("number");
      expect(typeof feature.properties.depthM).toBe("number");
    }
  });

  it("features include CMECS code string", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    for (const feature of res.body.features) {
      expect(typeof feature.properties.cmecsCode).toBe("string");
      expect(feature.properties.cmecsCode.length).toBeGreaterThan(0);
    }
  });

  it("features include a color hex string for rendering", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    for (const feature of res.body.features) {
      expect(feature.properties.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("metadata includes methodology and credit fields", async () => {
    const res = await request(app).get("/api/substrate/thorne-bay");
    expect(res.body.metadata).toBeDefined();
    expect(typeof res.body.metadata.methodology).toBe("string");
    expect(typeof res.body.metadata.credit).toBe("string");
  });
});
