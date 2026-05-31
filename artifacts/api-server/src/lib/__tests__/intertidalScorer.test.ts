import { describe, it, expect } from "vitest";
import {
  scoreTidepool,
  scoreBeachcombing,
  buildScoreSignals,
} from "../intertidalScorer.js";
import type { IntertidalScoringProps } from "../intertidalScorer.js";

// ---------------------------------------------------------------------------
// scoreTidepool
// ---------------------------------------------------------------------------

describe("scoreTidepool", () => {
  it("returns 0 for completely empty props", () => {
    expect(scoreTidepool({})).toBe(0);
  });

  it("scores mud substrate at 0 substrate points", () => {
    const score = scoreTidepool({ substrate: "mud" });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(10); // mud should give near-zero
  });

  it("scores bedrock highest among substrate types", () => {
    const bedrock = scoreTidepool({ substrate: "bedrock" });
    const gravel  = scoreTidepool({ substrate: "gravel" });
    const sand    = scoreTidepool({ substrate: "sand" });
    const mud     = scoreTidepool({ substrate: "mud" });
    expect(bedrock).toBeGreaterThan(gravel);
    expect(gravel).toBeGreaterThan(sand);
    expect(sand).toBeGreaterThan(mud);
  });

  it("adds points for szMaterial=Rock when substrate field is absent", () => {
    const withRock = scoreTidepool({ szMaterial: "Rock" });
    expect(withRock).toBeGreaterThan(0);
  });

  it("adds points for platform szForm (relief fallback)", () => {
    const platform = scoreTidepool({ substrate: "bedrock", szForm: "Platform" });
    const plain    = scoreTidepool({ substrate: "bedrock" });
    expect(platform).toBeGreaterThan(plain);
  });

  it("adds points for high rockSzHi", () => {
    const highRock = scoreTidepool({ substrate: "bedrock", rockSzHi: 7 });
    const noRock   = scoreTidepool({ substrate: "bedrock" });
    expect(highRock).toBeGreaterThan(noRock);
  });

  it("adds points proportional to znBioInv", () => {
    const high = scoreTidepool({ substrate: "bedrock", znBioInv: 5 });
    const low  = scoreTidepool({ substrate: "bedrock", znBioInv: 1 });
    expect(high).toBeGreaterThan(low);
  });

  it("adds points proportional to znBioAlg", () => {
    const high = scoreTidepool({ substrate: "bedrock", znBioAlg: 5 });
    const low  = scoreTidepool({ substrate: "bedrock", znBioAlg: 0 });
    expect(high).toBeGreaterThan(low);
  });

  it("subtracts 5 points for znUse > 3", () => {
    const quiet  = scoreTidepool({ substrate: "bedrock", znUse: 2 });
    const crowded = scoreTidepool({ substrate: "bedrock", znUse: 4 });
    expect(crowded).toBe(quiet - 5);
  });

  it("never exceeds 100", () => {
    const maxOut: IntertidalScoringProps = {
      substrate: "bedrock",
      szMaterial: "Rock",
      szForm: "Platform",
      rockSzHi: 8,
      znRelief: 5,
      znBioInv: 5,
      znBioAlg: 5,
    };
    expect(scoreTidepool(maxOut)).toBeLessThanOrEqual(100);
  });

  it("never goes below 0", () => {
    const worseThanBad: IntertidalScoringProps = {
      substrate: "mud",
      znUse: 5,
    };
    expect(scoreTidepool(worseThanBad)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// scoreBeachcombing
// ---------------------------------------------------------------------------

describe("scoreBeachcombing", () => {
  it("returns 0 for completely empty props", () => {
    expect(scoreBeachcombing({})).toBe(0);
  });

  it("scores sand highest for beachcombing substrate", () => {
    const sand   = scoreBeachcombing({ substrate: "sand" });
    const gravel = scoreBeachcombing({ substrate: "gravel" });
    const bed    = scoreBeachcombing({ substrate: "bedrock" });
    const mud    = scoreBeachcombing({ substrate: "mud" });
    expect(sand).toBeGreaterThan(gravel);
    expect(gravel).toBeGreaterThan(bed);
    expect(bed).toBeGreaterThan(mud);
  });

  it("gives roundness bonus for well-rounded stones", () => {
    const rounded  = scoreBeachcombing({ substrate: "gravel", roundness: "well-rounded" });
    const angular  = scoreBeachcombing({ substrate: "gravel", roundness: "angular" });
    expect(rounded).toBeGreaterThan(angular);
  });

  it("adds points for debris 4 (heavy) > debris 2 (light)", () => {
    const heavy = scoreBeachcombing({ substrate: "sand", znDebris: 4 });
    const light = scoreBeachcombing({ substrate: "sand", znDebris: 2 });
    expect(heavy).toBeGreaterThan(light);
  });

  it("adds energy and dynamism points", () => {
    const energetic = scoreBeachcombing({ substrate: "sand", znEnergy: 4, znDynamic: 4 });
    const calm      = scoreBeachcombing({ substrate: "sand", znEnergy: 1, znDynamic: 1 });
    expect(energetic).toBeGreaterThan(calm);
  });

  it("subtracts 5 for znUse > 3", () => {
    const quiet   = scoreBeachcombing({ substrate: "sand", znUse: 1 });
    const crowded = scoreBeachcombing({ substrate: "sand", znUse: 4 });
    expect(crowded).toBe(quiet - 5);
  });

  it("beach szForm boosts sand score", () => {
    const beachForm = scoreBeachcombing({ substrate: "sand", szForm: "Beach" });
    const flat      = scoreBeachcombing({ substrate: "sand", szForm: "Tidal Flat" });
    expect(beachForm).toBeGreaterThanOrEqual(flat);
  });

  it("never exceeds 100", () => {
    const maxOut: IntertidalScoringProps = {
      substrate: "sand",
      szForm: "Beach",
      roundness: "well-rounded",
      znDebris: 5,
      znEnergy: 5,
      znDynamic: 5,
    };
    expect(scoreBeachcombing(maxOut)).toBeLessThanOrEqual(100);
  });

  it("never goes below 0", () => {
    expect(scoreBeachcombing({ substrate: "mud", znUse: 5 })).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// buildScoreSignals
// ---------------------------------------------------------------------------

describe("buildScoreSignals", () => {
  it("returns a substrate label and whySummary for tidepool", () => {
    const sigs = buildScoreSignals({ substrate: "bedrock", szForm: "Platform" }, "tidepool");
    expect(sigs.substrate).toBeTruthy();
    expect(sigs.whySummary).toContain("tidepool");
  });

  it("returns a substrate label and whySummary for beachcombing", () => {
    const sigs = buildScoreSignals({ substrate: "sand", szForm: "Beach" }, "beachcombing");
    expect(sigs.substrate).toBeTruthy();
    expect(sigs.whySummary).toContain("beachcombing");
  });

  it("includes bioband chip when znBioInv provided", () => {
    const sigs = buildScoreSignals({ substrate: "bedrock", znBioInv: 3, znBioAlg: 2 }, "tidepool");
    expect(sigs.bioband).not.toBeNull();
    expect(sigs.bioband).toContain("inv 3/5");
  });

  it("includes debris chip when znDebris provided", () => {
    const sigs = buildScoreSignals({ substrate: "sand", znDebris: 4 }, "beachcombing");
    expect(sigs.debris).not.toBeNull();
    expect(sigs.debris).toContain("Moderate");
  });

  it("includes human-use chip when znUse provided", () => {
    const sigs = buildScoreSignals({ substrate: "bedrock", znUse: 1 }, "tidepool");
    expect(sigs.humanUse).not.toBeNull();
    expect(sigs.humanUse).toContain("Remote");
  });

  it("null chips when attributes absent", () => {
    const sigs = buildScoreSignals({ substrate: "bedrock" }, "tidepool");
    expect(sigs.bioband).toBeNull();
    expect(sigs.debris).toBeNull();
    expect(sigs.energy).toBeNull();
    expect(sigs.humanUse).toBeNull();
  });

  it("uses itzSubclass over szMaterial in substrate label", () => {
    const sigs = buildScoreSignals({ substrate: "bedrock", itzSubclass: "Bedrock platform", szMaterial: "Rock" }, "tidepool");
    expect(sigs.substrate).toBe("Bedrock platform");
  });
});
