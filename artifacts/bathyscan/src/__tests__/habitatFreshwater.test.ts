import { describe, it, expect } from "vitest";
import {
  FRESHWATER_SPECIES_IDS,
  SPECIES_CONFIGS,
  depthSuitability,
} from "@/lib/habitat";

describe("freshwater species catalogue", () => {
  it("includes the eight expected freshwater species", () => {
    expect(FRESHWATER_SPECIES_IDS).toHaveLength(8);
    expect(FRESHWATER_SPECIES_IDS).toEqual(
      expect.arrayContaining([
        "lake_trout",
        "rainbow_trout",
        "walleye",
        "largemouth_bass",
        "channel_catfish",
        "northern_pike",
        "yellow_perch",
        "crayfish",
      ]),
    );
  });

  it("marks every freshwater species with waterType=freshwater", () => {
    for (const id of FRESHWATER_SPECIES_IDS) {
      expect(SPECIES_CONFIGS[id].waterType).toBe("freshwater");
    }
  });
});

describe("freshwater depth suitability", () => {
  it("scores 1.0 inside the optimal depth range", () => {
    const bass = SPECIES_CONFIGS.largemouth_bass;
    expect(depthSuitability(4, bass)).toBe(1);
  });

  it("scores 0 outside the tolerance range", () => {
    const bass = SPECIES_CONFIGS.largemouth_bass;
    expect(depthSuitability(100, bass)).toBe(0);
  });

  it("tapers linearly between tolerance and optimal edges", () => {
    const crayfish = SPECIES_CONFIGS.crayfish;
    // optimal [0.5,5], tolerance [0,15] — depth=10 is between optMax(5) and tolMax(15)
    const score = depthSuitability(10, crayfish);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("scores rainbow trout high in shallow clear water", () => {
    const rt = SPECIES_CONFIGS.rainbow_trout;
    expect(depthSuitability(10, rt)).toBe(1);
    expect(depthSuitability(0, rt)).toBeGreaterThanOrEqual(0);
  });
});
