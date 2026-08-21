import { describe, expect, it } from "vitest";
import { processTerrainPoints } from "./service.js";

describe("terrain processing service", () => {
  it("returns terrain and overview grids with the server's south-first row order", () => {
    const points = [
      { lon: 0.0, lat: 0.0, depth: 10 },
      { lon: 0.2, lat: 0.0, depth: 10 },
      { lon: 0.4, lat: 0.0, depth: 10 },
      { lon: 0.6, lat: 0.0, depth: 10 },
      { lon: 0.8, lat: 0.0, depth: 10 },
      { lon: 0.0, lat: 1.0, depth: 100 },
      { lon: 0.2, lat: 1.0, depth: 100 },
      { lon: 0.4, lat: 1.0, depth: 100 },
      { lon: 0.6, lat: 1.0, depth: 100 },
      { lon: 0.8, lat: 1.0, depth: 100 },
    ];

    const { terrain, overview } = processTerrainPoints({
      points,
      resolution: 32,
      gridId: "service-test",
      datasetName: "service test",
      smoothing: false,
    });

    expect(terrain.width).toBe(32);
    expect(terrain.height).toBe(32);
    expect(overview.width).toBe(64);
    expect(overview.height).toBe(64);
    expect(terrain.depths[0]).toBe(10);
    expect(terrain.depths.at(-1)).toBe(100);
    expect(overview.depths[0]).toBe(10);
    expect(overview.depths.at(-1)).toBe(100);
  });
});