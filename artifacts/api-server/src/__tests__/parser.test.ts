import { describe, it, expect } from "vitest";
import { parseXyzCsv } from "../lib/terrain.js";

describe("parseXyzCsv — CSV format", () => {
  it("parses comma-delimited header CSV", () => {
    const csv = `lon,lat,depth\n142.0,11.0,3000\n142.1,11.1,5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
    expect(pts[1]).toMatchObject({ lon: 142.1, lat: 11.1, depth: 5000 });
  });

  it("parses tab-delimited CSV without header", () => {
    const csv = `142.0\t11.0\t3000\n142.1\t11.1\t5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
  });

  it("negates negative depth values (converts elevations to depths)", () => {
    const csv = `lon,lat,depth\n0.0,0.0,-3000\n1.0,1.0,-5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts[0]?.depth).toBe(3000);
    expect(pts[1]?.depth).toBe(5000);
  });

  it("skips comment lines starting with #", () => {
    const csv = `# this is a comment\nlon,lat,depth\n142.0,11.0,3000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(1);
  });

  it("skips rows with NaN fields", () => {
    const csv = `lon,lat,depth\n142.0,NaN,3000\n142.1,11.1,5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(1);
    expect(pts[0]?.lat).toBe(11.1);
  });

  it("handles space-delimited files without header", () => {
    const csv = `142.0 11.0 3000\n142.1 11.1 5000`;
    const pts = parseXyzCsv(csv, "data.csv");
    expect(pts).toHaveLength(2);
  });
});

describe("parseXyzCsv — XYZ format", () => {
  it("parses whitespace-delimited XYZ file", () => {
    const xyz = `142.0 11.0 3000\n142.1 11.1 5000\n`;
    const pts = parseXyzCsv(xyz, "bathymetry.xyz");
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lon: 142.0, lat: 11.0, depth: 3000 });
  });

  it("returns an empty array when file has only a header row", () => {
    const xyz = `lon lat depth`;
    const pts = parseXyzCsv(xyz, "data.xyz");
    expect(pts).toHaveLength(0);
  });
});
