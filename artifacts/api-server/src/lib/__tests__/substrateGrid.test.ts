import { describe, it, expect } from "vitest";
import {
  sampleSubstrateGrid,
  substrateFingerprintForDataset,
  substrateToZone,
  SUBSTRATE_TO_SALTWATER_ZONE,
  SUBSTRATE_TO_FRESHWATER_ZONE,
  _clearSubstrateFingerprintMemo,
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

  it("samples real substrate polygons for a preset Alaska dataset", () => {
    // glacier-bay sits inside the bundled ShoreZone footprint, so the sample
    // must report at least some covered cells from one of the four classes.
    const s = sampleSubstrateGrid("glacier-bay");
    expect(s.labels).toHaveLength(1024);
    expect(s.mask).toHaveLength(1024);
    expect(s.hasCoverage).toBe(true);
    expect(s.coveredCount).toBeGreaterThan(0);
    expect(s.coveredCount).toBeLessThanOrEqual(1024);
    expect(s.coverageFraction).toBeCloseTo(s.coveredCount / 1024, 6);
    // Every covered cell maps to one of the four CMECS broad classes.
    for (let i = 0; i < 1024; i++) {
      if (s.mask[i]) {
        expect(s.labels[i]).not.toBeNull();
        expect(["bedrock", "gravel", "sand", "mud"]).toContain(s.labels[i]);
      } else {
        expect(s.labels[i]).toBeNull();
      }
    }
    // Class counts must sum to the covered-cell count.
    const totalCounts = s.counts.bedrock + s.counts.gravel + s.counts.sand + s.counts.mud;
    expect(totalCounts).toBe(s.coveredCount);
    // Fingerprint is a non-zero 8-char hex string.
    expect(s.fingerprint).toMatch(/^[a-f0-9]{8}$/);
    expect(s.fingerprint).not.toBe("00000000");
  });

  it("produces a stable, deterministic fingerprint per dataset", () => {
    _clearSubstrateFingerprintMemo();
    const a = sampleSubstrateGrid("glacier-bay").fingerprint;
    const b = sampleSubstrateGrid("glacier-bay").fingerprint;
    expect(a).toBe(b);
    expect(substrateFingerprintForDataset("glacier-bay")).toBe(a);
  });

  it("produces a different fingerprint for two distinct covered datasets", () => {
    _clearSubstrateFingerprintMemo();
    const a = substrateFingerprintForDataset("glacier-bay");
    const b = substrateFingerprintForDataset("sitka-sound");
    expect(a).not.toBe(b);
    expect(a).not.toBe("00000000");
    expect(b).not.toBe("00000000");
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
