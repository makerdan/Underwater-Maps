import { describe, expect, it } from "vitest";
import { buildOverviewBboxResults } from "./overviewBboxResults";

const area = { north: 10, south: 0, east: 10, west: 0 };
const catalog = (id: string, name = id) => ({
  id,
  name,
  sourceAgency: "Public",
  dataType: "bathymetry" as const,
  coverageBbox: { minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 },
  waterType: "saltwater" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  relevanceScore: 1,
});
const upload = (id: string, name: string) => ({
  id,
  name,
  minDepth: 1,
  maxDepth: 2,
  createdAt: "2026-02-01T00:00:00.000Z",
  bbox: { minLon: 0, maxLon: 10, minLat: 0, maxLat: 10 },
});
const save = (id: string, catalogId: string, datasetId: string, name = catalogId) => ({
  id,
  catalogId,
  status: "ready" as const,
  requestedAt: "2026-01-01T00:00:00.000Z",
  datasetId,
  catalog: catalog(catalogId, name),
});

describe("buildOverviewBboxResults", () => {
  it("prioritizes collection members, then library, then public catalog", () => {
    const results = buildOverviewBboxResults(
      area,
      [catalog("public"), catalog("saved-catalog")],
      [upload("library", "Library survey")],
      [save("save-1", "saved-catalog", "saved-dataset")],
      ["library"],
    );

    expect(results.map((result) => result.loadDatasetId)).toEqual([
      "library",
      "saved-dataset",
      "public",
    ]);
  });

  it("deduplicates by catalog identity and materialized target, not display name", () => {
    const results = buildOverviewBboxResults(
      area,
      [catalog("same-catalog"), catalog("different-catalog", "Same name")],
      [upload("upload-a", "Same name"), upload("upload-b", "Same name")],
      [save("save-1", "same-catalog", "upload-a", "Same name")],
      null,
    );

    expect(results.map((result) => result.loadDatasetId)).toEqual([
      "upload-a",
      "upload-b",
      "different-catalog",
    ]);
  });

  it("keeps only intersecting ready library rows and remains filter-compatible", () => {
    const results = buildOverviewBboxResults(
      area,
      [],
      [
        upload("inside", "Inside"),
        {
          ...upload("outside", "Outside"),
          bbox: { minLon: 20, maxLon: 30, minLat: 20, maxLat: 30 },
        },
      ],
      [{ ...save("processing", "processing", "processing-dataset"), status: "processing" as const }],
      null,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "Inside",
      dataType: "bathymetry",
      resultKind: "library",
    });
  });
});