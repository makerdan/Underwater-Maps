import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/satelliteTile.js", () => ({
  fetchSatelliteTile: vi.fn(),
}));

vi.mock("../../lib/terrainTile.js", () => ({
  fetchTerrainTile: vi.fn(),
}));

vi.mock("../../lib/substrateGrid.js", () => ({
  substrateFingerprintForDataset: vi.fn(() => "00000000"),
}));

vi.mock("@workspace/db", async () => {
  const { createDbMock } = await import("../../__tests__/helpers/db-mock.js");
  return createDbMock();
});

import { fetchSatelliteTile } from "../../lib/satelliteTile.js";
import { fetchTerrainTile } from "../../lib/terrainTile.js";
import datasetTerrainRouter from "../datasets-terrain.js";

const app = express();
app.use("/api", datasetTerrainRouter);

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const mockSatelliteTile = vi.mocked(fetchSatelliteTile);
const mockTerrainTile = vi.mocked(fetchTerrainTile);

beforeEach(() => {
  vi.clearAllMocks();
  mockSatelliteTile.mockResolvedValue(PNG_BYTES);
  mockTerrainTile.mockResolvedValue(PNG_BYTES);
});

describe.each([
  {
    path: "satellite-tile",
    fetchTile: mockSatelliteTile,
  },
  {
    path: "terrain-tile",
    fetchTile: mockTerrainTile,
  },
])("GET /api/terrain/$path", ({ path, fetchTile }) => {
  it("returns the upstream PNG with the documented cache contract", async () => {
    const response = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: "-122.5,37.5,-121.5,38.5", size: "256" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=86400, immutable",
    );
    expect(response.headers["content-length"]).toBe(String(PNG_BYTES.length));
    expect(fetchTile).toHaveBeenCalledWith(
      { minLon: -122.5, minLat: 37.5, maxLon: -121.5, maxLat: 38.5 },
      256,
    );
  });

  it("preserves antimeridian-crossing bounding boxes", async () => {
    const response = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: "170,45,-160,50" });

    expect(response.status).toBe(200);
    expect(fetchTile).toHaveBeenCalledWith(
      { minLon: 170, minLat: 45, maxLon: -160, maxLat: 50 },
      512,
    );
  });

  it("rejects malformed and degenerate bounding boxes before fetching", async () => {
    const malformed = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: "1,2,3" });
    const arrayInjected = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: ["1,2,3,4", "5,6,7,8"] });
    const degenerate = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: "1,2,1,3" });

    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("invalid_param");
    expect(arrayInjected.status).toBe(400);
    expect(arrayInjected.body.error).toBe("invalid_param");
    expect(degenerate.status).toBe(400);
    expect(degenerate.body.error).toBe("invalid_bbox");
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it("returns a structured 502 when the upstream tile fetch fails", async () => {
    fetchTile.mockRejectedValueOnce(new Error("upstream unavailable"));

    const response = await request(app)
      .get(`/api/terrain/${path}`)
      .query({ bbox: "-122.5,37.5,-121.5,38.5" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "upstream_error",
      details: "upstream unavailable",
    });
  });
});