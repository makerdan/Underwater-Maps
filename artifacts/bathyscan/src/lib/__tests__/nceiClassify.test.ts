/**
 * Unit tests for nceiClassify — the heuristic data-type classifier used by
 * the "Other data in this area" section to badge broadened NCEI Geoportal
 * records, and to filter bathymetry records out of that reference list so
 * they never duplicate the main bathymetry results.
 */
import { describe, it, expect } from "vitest";
import {
  classifyNceiDataType,
  NCEI_TYPE_BADGE_COLORS,
  type NceiDataType,
} from "../nceiClassify";

describe("classifyNceiDataType", () => {
  it("classifies bathymetry from title keywords", () => {
    expect(classifyNceiDataType("Multibeam Bathymetric Survey H12345")).toBe("bathymetry");
    expect(classifyNceiDataType("Southeast Alaska DEM")).toBe("bathymetry");
    expect(classifyNceiDataType("Hydrographic Survey of Clarence Strait")).toBe("bathymetry");
  });

  it("classifies lidar", () => {
    expect(classifyNceiDataType("2019 USACE Topobathy Lidar: Alaska")).toBe("lidar");
  });

  it("classifies imagery", () => {
    expect(classifyNceiDataType("Side-scan sonar mosaic")).toBe("imagery");
    expect(classifyNceiDataType("Aerial photo collection 1998")).toBe("imagery");
  });

  it("classifies oceanographic", () => {
    expect(classifyNceiDataType("CTD casts, Gulf of Alaska")).toBe("oceanographic");
    expect(classifyNceiDataType("Water temperature and salinity profiles")).toBe("oceanographic");
    expect(classifyNceiDataType("Tide gauge records")).toBe("oceanographic");
  });

  it("classifies geophysical", () => {
    expect(classifyNceiDataType("Marine magnetic anomaly data")).toBe("geophysical");
    expect(classifyNceiDataType("Seismic reflection profiles")).toBe("geophysical");
    expect(classifyNceiDataType("Sediment core samples")).toBe("geophysical");
  });

  it("classifies climate", () => {
    expect(classifyNceiDataType("Monthly climate normals")).toBe("climate");
    expect(classifyNceiDataType("Storm events database")).toBe("climate");
  });

  it("falls back to 'other' when nothing matches", () => {
    expect(classifyNceiDataType("Fisheries catch statistics")).toBe("other");
    expect(classifyNceiDataType("")).toBe("other");
  });

  it("uses the description when the title is uninformative", () => {
    expect(
      classifyNceiDataType("Survey H99999", "Bathymetric depth soundings collected in 2004"),
    ).toBe("bathymetry");
    expect(classifyNceiDataType("Dataset A-1", "buoy observations of currents")).toBe(
      "oceanographic",
    );
    expect(classifyNceiDataType("Dataset A-1", null)).toBe("other");
  });

  it("gives bathymetry precedence over later rules when both match", () => {
    // "multibeam" (bathymetry) + "backscatter" (imagery) — first rule wins.
    expect(classifyNceiDataType("Multibeam backscatter mosaic")).toBe("bathymetry");
  });

  it("has a badge color for every data type", () => {
    const types: NceiDataType[] = [
      "bathymetry",
      "lidar",
      "imagery",
      "oceanographic",
      "geophysical",
      "climate",
      "other",
    ];
    for (const t of types) {
      expect(NCEI_TYPE_BADGE_COLORS[t]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
