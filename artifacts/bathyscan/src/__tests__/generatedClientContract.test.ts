import { describe, expect, it } from "vitest";
import {
  getGetDatasetsIdTerrainQueryKey,
  getGetDatasetsIdTerrainUrl,
  useGetDatasetsIdTerrain,
  type TerrainData,
} from "@workspace/api-client-react";

describe("generated API client exports", () => {
  it("keeps the dataset path, query name and public hook export", () => {
    const url = getGetDatasetsIdTerrainUrl("ds-1", { resolution: 32 });
    expect(url).toContain("/datasets/ds-1/terrain");
    expect(url).toContain("resolution=32");
    expect(getGetDatasetsIdTerrainQueryKey("ds-1", { resolution: 32 })).toEqual(
      ["/api/datasets/ds-1/terrain", { resolution: 32 }],
    );
    expect(typeof useGetDatasetsIdTerrain).toBe("function");
  });

  it("keeps response types available through the client barrel", () => {
    const terrain: Pick<TerrainData, "datasetId" | "resolution"> = {
      datasetId: "ds-1",
      resolution: 32,
    };
    expect(terrain.resolution).toBe(32);
  });
});