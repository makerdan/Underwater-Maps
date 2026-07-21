import { describe, it, expect } from "vitest";
import {
  sampleSubstrateGrid,
  substrateToZone,
  SUBSTRATE_TO_SALTWATER_ZONE,
  SUBSTRATE_TO_FRESHWATER_ZONE,
} from "../substrateGrid.js";

describe("sampleSubstrateGrid", () => {
  it("returns the empty sample for unknown / non-preset dataset ids", () => {
    const s = sampleSubstrateGrid("totally-not-a-dataset");
    expect(s.hasCoverage).toBe(false);
    expect(s.coveredCount).toBe(0);
    expect(s.coverageFraction).toBe(0);
    expect(s.labels).toHaveLength(1024);
    expect(s.mask).toHaveLength(1024);
    expect(s.labels.every((l) => l === null)).toBe(true);
    expect(s.mask.every((m) => m === false)).toBe(true);
    expect(s.fingerprint).toBe("00000000");
  });

  it("returns the empty sample for an empty dataset id", () => {
    const s = sampleSubstrateGrid("");
    expect(s.hasCoverage).toBe(false);
    expect(s.fingerprint).toBe("00000000");
  });

});

describe("substrateToZone mappings", () => {
  it("maps every CMECS class to a saltwater zone label", () => {
    expect(substrateToZone("bedrock", "saltwater")).toBe(SUBSTRATE_TO_SALTWATER_ZONE.bedrock);
    expect(substrateToZone("gravel", "saltwater")).toBe(SUBSTRATE_TO_SALTWATER_ZONE.gravel);
    expect(substrateToZone("sand", "saltwater")).toBe(SUBSTRATE_TO_SALTWATER_ZONE.sand);
    expect(substrateToZone("mud", "saltwater")).toBe(SUBSTRATE_TO_SALTWATER_ZONE.mud);
  });

  it("maps every CMECS class to a freshwater zone label", () => {
    expect(substrateToZone("bedrock", "freshwater")).toBe(SUBSTRATE_TO_FRESHWATER_ZONE.bedrock);
    expect(substrateToZone("gravel", "freshwater")).toBe(SUBSTRATE_TO_FRESHWATER_ZONE.gravel);
    expect(substrateToZone("sand", "freshwater")).toBe(SUBSTRATE_TO_FRESHWATER_ZONE.sand);
    expect(substrateToZone("mud", "freshwater")).toBe(SUBSTRATE_TO_FRESHWATER_ZONE.mud);
  });
});
