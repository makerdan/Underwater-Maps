import { describe, it, expect } from "vitest";
import {
  heuristicClassifyByDepth,
  SALTWATER_HEURISTIC_BANDS,
  FRESHWATER_HEURISTIC_BANDS,
} from "../poe.js";

function rampDepths(): number[] {
  const out = new Array<number>(1024);
  for (let i = 0; i < 1024; i++) out[i] = i;
  return out;
}

describe("heuristicClassifyByDepth", () => {
  it("returns exactly 1024 labels for a saltwater ramp, banded by quartile", () => {
    const zones = heuristicClassifyByDepth(rampDepths(), "saltwater");
    expect(zones).toHaveLength(1024);
    // Pick indices clearly inside each quartile (avoid the boundary indices
    // 256/512/768 which sit exactly on a threshold and fall to the lower band).
    expect(zones[0]).toBe(SALTWATER_HEURISTIC_BANDS[0]);
    expect(zones[300]).toBe(SALTWATER_HEURISTIC_BANDS[1]);
    expect(zones[600]).toBe(SALTWATER_HEURISTIC_BANDS[2]);
    expect(zones[900]).toBe(SALTWATER_HEURISTIC_BANDS[3]);
    expect(zones[1023]).toBe(SALTWATER_HEURISTIC_BANDS[3]);
    // All four bands must appear at least once for a monotonic ramp.
    expect(new Set(zones).size).toBe(4);
  });

  it("uses freshwater labels when waterType is freshwater", () => {
    const zones = heuristicClassifyByDepth(rampDepths(), "freshwater");
    const unique = new Set(zones);
    for (const z of unique) {
      expect(FRESHWATER_HEURISTIC_BANDS).toContain(z as typeof FRESHWATER_HEURISTIC_BANDS[number]);
    }
    // All four bands should be present for a monotonic ramp.
    expect(unique.size).toBe(4);
  });

  it("returns all-shallow when every depth is identical", () => {
    const zones = heuristicClassifyByDepth(new Array(1024).fill(42), "saltwater");
    expect(zones).toHaveLength(1024);
    // With q1=q2=q3=42, every value satisfies d<=q1 so all map to band 0.
    expect(zones.every((z) => z === SALTWATER_HEURISTIC_BANDS[0])).toBe(true);
  });

  it("tolerates short input by treating missing cells as the shallowest band", () => {
    const zones = heuristicClassifyByDepth([1, 2, 3], "saltwater");
    expect(zones).toHaveLength(1024);
    // 1021 of the 1024 cells will be the min finite value (1) → band 0.
    const counts = new Map<string, number>();
    for (const z of zones) counts.set(z, (counts.get(z) ?? 0) + 1);
    expect(counts.get(SALTWATER_HEURISTIC_BANDS[0])).toBeGreaterThan(1000);
  });

  it("tolerates non-finite values without crashing", () => {
    const depths = new Array(1024).fill(0).map((_, i) => (i % 7 === 0 ? Number.NaN : i));
    const zones = heuristicClassifyByDepth(depths, "saltwater");
    expect(zones).toHaveLength(1024);
    for (const z of zones) {
      expect(SALTWATER_HEURISTIC_BANDS).toContain(z as typeof SALTWATER_HEURISTIC_BANDS[number]);
    }
  });

  it("returns all-shallowest when every depth is non-finite", () => {
    const depths = new Array(1024).fill(Number.NaN);
    const zones = heuristicClassifyByDepth(depths, "freshwater");
    expect(zones).toHaveLength(1024);
    expect(zones.every((z) => z === FRESHWATER_HEURISTIC_BANDS[0])).toBe(true);
  });
});
